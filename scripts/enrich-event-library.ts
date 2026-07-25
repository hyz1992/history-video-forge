// 事件库完善脚本：把源清单的事件骨架 → 完整 Event Library JSON
//
// 用法（小范围验证，先跑 5 条）：
//   node --import tsx scripts/enrich-event-library.ts --limit 5
//
// 用法（全量 A 级，约 202 条）：
//   node --import tsx scripts/enrich-event-library.ts --priority A
//
// 用法（指定朝代，分批跑）：
//   node --import tsx scripts/enrich-event-library.ts --dynasty 春秋
//
// 产物：storage/event-library/<dynasty-slug>/<event-slug>.json
// 跑完后调 POST /api/admin/event-library/sync 入库（或用 --sync 自动入库）
//
// 幂等：同 event_slug 文件已存在则跳过（不覆盖，避免重跑覆盖已校验的）
// 失败：单条失败记到 enrich-fail-list.json，不中断整批

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { createLlmGateway } from "../backend/src/runtime/llm/llm-gateway.js";
import { createPromptRegistry } from "../backend/src/runtime/prompts/prompt-registry.js";
import { createTierAwareProviderFromEnv } from "../backend/src/runtime/llm/tier-aware-provider-factory.js";
import { parseEventLibraryFile } from "../backend/src/modules/event-library/event-library.codec.js";
import { toAsciiSlug, EVENT_LIBRARY_ROOT_DIR } from "../backend/src/modules/event-library/event-library.path.js";

// ---- 参数解析 ----

interface CliArgs {
  limit?: number;
  priority?: "A" | "B" | "C";
  dynasty?: string;
  sync: boolean;
  force: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { sync: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      result.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--priority" && args[i + 1]) {
      const p = args[i + 1] as "A" | "B" | "C";
      if (p !== "A" && p !== "B" && p !== "C") {
        throw new Error(`--priority 只支持 A/B/C，收到: ${args[i + 1]}`);
      }
      result.priority = p;
      i++;
    } else if (arg === "--dynasty" && args[i + 1]) {
      result.dynasty = args[i + 1];
      i++;
    } else if (arg === "--sync") {
      result.sync = true;
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`用法: node --import tsx scripts/enrich-event-library.ts [选项]

选项:
  --limit N        只处理前 N 条（小范围验证用）
  --priority A|B|C 只处理指定优先级（A=高质量主线，B=补充，C=边缘）
  --dynasty 春秋   只处理指定朝代
  --sync           跑完后自动调 sync 入库（需 DB 已初始化）
  --force          覆盖已存在的 JSON 文件（默认跳过已存在的）
  --help           显示帮助`);
      process.exit(0);
    }
  }
  return result;
}

// ---- 源清单类型 ----

interface RawEventSkeleton {
  id: string;
  title: string;
  era?: string;
  dynasty?: string;
  category?: string;
  corePeople?: string[];
  tags?: string[];
  storyScore?: number;
  priority?: string;
  enabled?: boolean;
}

interface RawTopicLibrary {
  libraryKey: string;
  version: number;
  items: RawEventSkeleton[];
}

const SOURCE_LIBRARY_PATH = "D:\\ai_learn\\story-forge\\backend\\assets\\topic-libraries\\historical-story.raw-topic-library.json";

function loadSourceLibrary(args: CliArgs): RawEventSkeleton[] {
  if (!existsSync(SOURCE_LIBRARY_PATH)) {
    throw new Error(`源清单不存在: ${SOURCE_LIBRARY_PATH}`);
  }
  const raw = readFileSync(SOURCE_LIBRARY_PATH, "utf8");
  const lib = JSON.parse(raw) as RawTopicLibrary;

  let items = lib.items.filter((item) => item.enabled !== false);

  if (args.priority) {
    items = items.filter((item) => item.priority === args.priority);
  }
  if (args.dynasty) {
    items = items.filter((item) => item.dynasty === args.dynasty);
  }
  if (args.limit && args.limit > 0) {
    items = items.slice(0, args.limit);
  }

  return items;
}

// ---- LLM 调用 + Zod 校验 ----

async function enrichOne(
  gateway: ReturnType<typeof createLlmGateway>,
  skeleton: RawEventSkeleton,
): Promise<Record<string, unknown>> {
  const input = {
    title: skeleton.title,
    era: skeleton.era,
    dynasty: skeleton.dynasty,
    category: skeleton.category,
    corePeople: skeleton.corePeople ?? [],
    tags: skeleton.tags ?? [],
  };

  const raw = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "event-library.enrich",
    input,
  });

  // Zod 严格校验：不通过直接抛错，调用方记到 fail-list
  const parsed = parseEventLibraryFile(raw) as unknown as Record<string, unknown>;

  // 硬保障：dynasty/era 必须与骨架一致，LLM 不得修改
  // （否则会出现"战国"→"魏"这类分类漂移，导致文件分散到不同目录）
  if (skeleton.dynasty) {
    parsed.dynasty = skeleton.dynasty;
  }
  if (skeleton.era) {
    parsed.era = skeleton.era;
  }

  return parsed;
}

// ---- 文件写入 ----

function buildOutputPath(parsed: Record<string, unknown>): string {
  const dynasty = (parsed.dynasty as string | undefined) ?? "unknown";
  const canonicalTitle = parsed.canonicalTitle as string;
  const dynastySlug = toAsciiSlug(dynasty);
  const eventSlug = toAsciiSlug(canonicalTitle);
  return join(EVENT_LIBRARY_ROOT_DIR, dynastySlug, `${eventSlug}.json`);
}

function writeEventFile(relativePath: string, parsed: Record<string, unknown>): void {
  const absolutePath = resolve(process.cwd(), relativePath);
  const dir = resolve(absolutePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // 格式化输出，便于 diff 和 review
  writeFileSync(absolutePath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

// ---- 主流程 ----

interface EnrichResult {
  skeleton: RawEventSkeleton;
  status: "ok" | "skipped" | "failed";
  outputPath?: string;
  error?: string;
}

async function main() {
  const args = parseArgs();
  const skeletons = loadSourceLibrary(args);
  console.log(`待处理: ${skeletons.length} 条`);
  if (skeletons.length === 0) {
    console.log("无符合条件的条目，退出");
    return;
  }

  const provider = createTierAwareProviderFromEnv();
  const registry = createPromptRegistry();
  const gateway = createLlmGateway({ registry, provider });

  const results: EnrichResult[] = [];
  const failList: Array<{ id: string; title: string; error: string }> = [];

  for (let i = 0; i < skeletons.length; i++) {
    const skeleton = skeletons[i];
    const progress = `[${i + 1}/${skeletons.length}]`;

    // 预检输出路径，幂等跳过
    try {
      const outputPath = buildOutputPath({
        dynasty: skeleton.dynasty,
        canonicalTitle: skeleton.title,
      } as Record<string, unknown>);
      const absolutePath = resolve(process.cwd(), outputPath);
      if (existsSync(absolutePath) && !args.force) {
        console.log(`${progress} 跳过（已存在）: ${skeleton.title}`);
        results.push({ skeleton, status: "skipped", outputPath });
        continue;
      }
    } catch {
      // 预检失败不阻塞，继续尝试 LLM
    }

    process.stdout.write(`${progress} 处理中: ${skeleton.title}... `);
    const t0 = Date.now();
    try {
      const parsed = await enrichOne(gateway, skeleton);
      const outputPath = buildOutputPath(parsed);
      writeEventFile(outputPath, parsed);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`OK (${elapsed}s) → ${outputPath}`);
      results.push({ skeleton, status: "ok", outputPath });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`FAIL (${elapsed}s): ${error}`);
      results.push({ skeleton, status: "failed", error });
      failList.push({
        id: skeleton.id,
        title: skeleton.title,
        error,
      });
    }
  }

  // 写 fail-list
  if (failList.length > 0) {
    const failPath = resolve(process.cwd(), "enrich-fail-list.json");
    writeFileSync(failPath, JSON.stringify(failList, null, 2) + "\n", "utf8");
    console.log(`\n失败 ${failList.length} 条，已记录到 enrich-fail-list.json`);
  }

  // 统计
  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`\n========== 完成 ==========`);
  console.log(`成功: ${ok} | 跳过: ${skipped} | 失败: ${failed} | 总计: ${results.length}`);

  // 自动 sync（可选）
  if (args.sync && ok > 0) {
    console.log(`\n--sync 指定，但自动入库需要在应用上下文中运行，请手动调:`);
    console.log(`  curl -X POST http://localhost:3000/api/admin/event-library/sync (需 admin 鉴权)`);
    console.log(`或参考 syncEventLibraryFromFiles 直接调用`);
  }
}

main().catch((e) => {
  console.error("未捕获错误:", e);
  process.exit(1);
});
