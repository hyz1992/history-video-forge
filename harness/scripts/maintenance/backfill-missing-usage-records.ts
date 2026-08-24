/**
 * 补记因数据库缺列而失败的 LLM usage 记账（一次性维护脚本）。
 *
 * 背景：S2-2 报价体系移除的迁移（20260823000000_s2_2_usage_unit_detail，
 * 给 UsageCostRecord 增加 unitDetailJson 列）部署前，已成功 run 的 LLM
 * 记账在落库时因列缺失整体失败。审计事件 usage_recording_failed 留痕了
 * 每次失败的 interaction_id，interaction 日志文件保留真实 token 用量。
 * 本脚本按审计事件反查 interaction 日志，复用生产 recordLlmUsage 以同一
 * 语义补写 UsageCostRecord（按唯一记账键幂等，已存在的记录跳过）。
 *
 * 边界（诚实原则）：
 * - 只处理 status=succeeded 的 run；failed/canceled 的 run 不伪造成功记账。
 * - 只支持单 attempt（attemptIndex=0）的 interaction：日志中的 token 是
 *   整次调用的汇总，多 attempt 无法拆分到每次调用，跳过并告警。
 * - 金额按当前目录计价（与实时记账同一路径）；目录未登记单价（unpriced）
 *   时金额保持 0，绝不伪造价格。
 *
 * 用法：
 *   npx tsx harness/scripts/maintenance/backfill-missing-usage-records.ts            # 演练（默认）
 *   npx tsx harness/scripts/maintenance/backfill-missing-usage-records.ts --confirm  # 实际写入
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  createDbClient,
  type ProviderModelCatalogRecord,
  type RunConfigurationSnapshotRecord,
} from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import {
  OPERATION_FALLBACK_TIER,
  PROMPT_ID_TO_TIER,
} from "../../../backend/src/modules/generation-cost/llm-billing-writer.js";
import { recordLlmUsage } from "../../../backend/src/modules/generation-cost/usage-cost-recorder.js";
import { buildProjectStorageRelativeDir } from "../../../backend/src/runtime/trace/project-storage.js";
import type { GenerationOperation } from "../../../../shared/src/index.js";

/** run.operation → trace 阶段目录名（与 project-storage.ts 布局一致）。 */
const STAGE_RUNS_DIR: Record<string, string> = {
  "topic.generate": "topic-runs",
  "script.generate": "script-runs",
  "storyboard.generate": "storyboard-runs",
  "asset_plan.generate": "asset-planning-runs",
  "publish.generate": "publish-runs",
};

/** Prisma Json 字段可能返回对象或 JSON 字符串，统一归一为对象。 */
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 非 JSON 字符串：按空对象处理
    }
  }
  return {};
}

function buildShortId(projectId: string): string {
  const compact = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `p_${(compact.slice(0, 8) || "00000000").padEnd(8, "0")}`;
}

/** 解析项目在磁盘上的存储根目录（兼容日期布局与 UUID 布局的残留）。 */
function resolveProjectStorageRootDir(input: {
  createdAt: Date;
  displayName: string;
  shortId: string;
  storageKey: string;
}): string {
  const projectsRoot = resolve(process.cwd(), "storage", "projects");
  // buildProjectStorageRelativeDir 返回以 storage/projects 开头的相对路径
  //（与生产写入布局一致），这里拼接工作区根目录。
  const dateLayout = resolve(
    process.cwd(),
    buildProjectStorageRelativeDir({
      createdAt: input.createdAt,
      displayName: input.displayName,
      shortId: input.shortId,
    }),
  );
  const uuidLayout = join(projectsRoot, input.storageKey);
  if (existsSync(join(dateLayout, "project.json"))) return dateLayout;
  if (existsSync(join(uuidLayout, "project.json"))) return uuidLayout;
  if (existsSync(dateLayout)) return dateLayout;
  if (existsSync(uuidLayout)) return uuidLayout;
  return dateLayout;
}

function parseMetadataNumber(text: string, key: string): number | null {
  const match = text.match(new RegExp(`^- ${key}: (\\d+)\\s*$`, "m"));
  return match ? Number.parseInt(match[1], 10) : null;
}

/** 统计 interaction 日志「调用明细」表中的 attempt 行数。 */
function countAttemptRows(text: string): number {
  return text
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|\s*/.test(line.trim()))
    .length;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const confirm = args.has("--confirm");
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    resolve(process.cwd(), "storage", "history-video-forge.db");

  const prisma = await createPrismaClient(databaseUrl);
  const db = createDbClient();
  db.thirdAggregateWriter = new PrismaThirdAggregateWriter(prisma);

  const catalogRows = await prisma.providerModelCatalog.findMany();
  for (const row of catalogRows) {
    db.providerModelCatalog.set(row.id, {
      id: row.id,
      capability: row.capability,
      providerKey: row.providerKey,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      displayName: row.displayName,
      qualityTier: row.qualityTier,
      speedTier: row.speedTier,
      parameterCapabilitiesJson: asObject(row.parameterCapabilitiesJson),
      pricingVersion: row.pricingVersion,
      pricingJson: asObject(row.pricingJson),
      status: row.status,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } satisfies ProviderModelCatalogRecord);
  }

  const failedEvents = await prisma.generationRunEvent.findMany({
    where: { eventType: "usage_recording_failed" },
    orderBy: { createdAt: "asc" },
  });

  let written = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const event of failedEvents) {
    const payload = asObject(event.eventJson);
    const interactionId =
      typeof payload["interaction_id"] === "string" ? payload["interaction_id"] : null;
    const operationName =
      typeof payload["operation_name"] === "string" ? payload["operation_name"] : null;
    if (!interactionId || !operationName) {
      notes.push(`${event.id}: 审计事件缺少 interaction_id/operation_name，跳过`);
      skipped += 1;
      continue;
    }

    const parts = interactionId.split(":");
    const moduleRunId = parts[0];
    const attemptIndex = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (parts.length !== 3 || !Number.isInteger(attemptIndex)) {
      notes.push(`${interactionId}: interaction_id 结构异常，跳过`);
      skipped += 1;
      continue;
    }
    if (attemptIndex !== 0) {
      notes.push(`${interactionId}: 多 attempt 调用无法从汇总日志拆分，跳过`);
      skipped += 1;
      continue;
    }

    const run = await prisma.generationRun.findUnique({
      where: { id: event.generationRunId },
    });
    if (!run) {
      notes.push(`${interactionId}: run ${event.generationRunId} 不存在，跳过`);
      skipped += 1;
      continue;
    }
    if (run.status !== "succeeded") {
      notes.push(`${interactionId}: run 状态 ${run.status} 非 succeeded，跳过`);
      skipped += 1;
      continue;
    }

    const snapshotRow = await prisma.runConfigurationSnapshot.findUnique({
      where: { id: run.runConfigurationSnapshotId },
    });
    if (!snapshotRow) {
      notes.push(`${interactionId}: 快照 ${run.runConfigurationSnapshotId} 不存在，跳过`);
      skipped += 1;
      continue;
    }
    const tier =
      PROMPT_ID_TO_TIER[operationName] ??
      OPERATION_FALLBACK_TIER[run.operation as GenerationOperation];
    const resolvedCaps = asObject(asObject(snapshotRow.resolvedConfigurationJson)["resolved_capabilities"]);
    const capability = asObject(resolvedCaps[tier]);
    const providerKey = typeof capability["provider_key"] === "string" ? capability["provider_key"] : null;
    const modelId = typeof capability["model_id"] === "string" ? capability["model_id"] : null;
    if (!providerKey || !modelId) {
      notes.push(`${interactionId}: 快照缺少 ${tier} 执行绑定，跳过`);
      skipped += 1;
      continue;
    }

    const project = await prisma.project.findUnique({ where: { id: run.projectId } });
    if (!project) {
      notes.push(`${interactionId}: 项目 ${run.projectId} 不存在，跳过`);
      skipped += 1;
      continue;
    }
    const stageDir = STAGE_RUNS_DIR[run.operation];
    if (!stageDir) {
      notes.push(`${interactionId}: 未知 operation ${run.operation}，跳过`);
      skipped += 1;
      continue;
    }
    const rootDir = resolveProjectStorageRootDir({
      createdAt: project.createdAt,
      displayName: project.storageDisplayName || project.name,
      shortId: buildShortId(project.id),
      storageKey: project.storageKey,
    });
    const interactionsDir = join(rootDir, "trace", stageDir, moduleRunId, "llm-interactions");
    let logFile: string | null = null;
    try {
      logFile =
        readdirSync(interactionsDir).find((file) => file.endsWith(`-${operationName}.md`)) ?? null;
    } catch {
      logFile = null;
    }
    if (!logFile) {
      notes.push(`${interactionId}: 找不到 interaction 日志（${interactionsDir}），跳过`);
      skipped += 1;
      continue;
    }
    const text = readFileSync(join(interactionsDir, logFile), "utf8");
    const inputTokens = parseMetadataNumber(text, "prompt_tokens");
    const outputTokens = parseMetadataNumber(text, "completion_tokens");
    const durationMs = parseMetadataNumber(text, "invocation_duration_ms");
    if (inputTokens === null || outputTokens === null) {
      notes.push(`${interactionId}: 日志缺少 token 用量，跳过`);
      skipped += 1;
      continue;
    }
    if (countAttemptRows(text) !== 1) {
      notes.push(`${interactionId}: 日志含多 attempt 汇总，无法拆分，跳过`);
      skipped += 1;
      continue;
    }

    const providerRequestKey = `llm:${run.id}:${operationName}`;
    const existing = await prisma.usageCostRecord.findUnique({
      where: {
        runConfigurationSnapshotId_providerRequestKey_attemptIndex: {
          runConfigurationSnapshotId: snapshotRow.id,
          providerRequestKey,
          attemptIndex: 0,
        },
      },
    });
    if (existing) {
      notes.push(`${interactionId}: 记账已存在，跳过`);
      skipped += 1;
      continue;
    }

    if (!confirm) {
      console.log(
        `[dry-run] ${run.operation}/${operationName}: ` +
          `in=${inputTokens} out=${outputTokens} duration=${durationMs ?? "-"}ms tier=${tier} ${providerKey}/${modelId}`,
      );
      written += 1;
      continue;
    }

    const outcome = await recordLlmUsage({
      db,
      // recordLlmUsage 只读取快照 id（记账键归属），无需完整记录。
      snapshot: { id: snapshotRow.id } as RunConfigurationSnapshotRecord,
      runId: run.id,
      operationOf: run.operation as GenerationOperation,
      interactionId,
      operationName,
      capability: tier,
      providerKey,
      modelId,
      inputTokens,
      outputTokens,
      durationMs: durationMs ?? undefined,
      status: "succeeded",
      attemptIndex: 0,
    });
    console.log(
      `[written] ${run.operation}/${operationName}: record=${outcome.record.id} ` +
        `in=${outcome.record.inputUnits ?? 0} out=${outcome.record.outputUnits ?? 0} ` +
        `estimated=${outcome.record.estimatedCostMicros} micros actual=${outcome.record.actualCostMicros ?? "null"} ` +
        `basis=${outcome.record.costBasis}`,
    );
    written += 1;
  }

  console.log(`\n完成：${confirm ? "实际写入" : "演练（未写入，加 --confirm 执行）"}。`);
  console.log(`候选补记 ${written} 条，跳过 ${skipped} 条。`);
  for (const note of notes) console.log(`- ${note}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
