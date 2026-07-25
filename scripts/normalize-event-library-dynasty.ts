// 事件库朝代归一化脚本
//
// 功能：
//   1. 将分散的 dynasty 值（如"汉末""新莽末""明清之际"等）归一化为标准大朝代
//   2. 同时调整 era 字段，保留时期粒度
//   3. 移动文件到新的 dynasty 目录
//   4. 删除空目录
//
// 用法：
//   node --import tsx scripts/normalize-event-library-dynasty.ts [--execute]
//   不加 --execute 时为 dry-run，只打印计划

import { readFileSync, writeFileSync, existsSync, readdirSync, rmdirSync, renameSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVENT_LIBRARY_ROOT_DIR, toAsciiSlug } from "../backend/src/modules/event-library/event-library.path.js";
import { parseEventLibraryFile } from "../backend/src/modules/event-library/event-library.codec.js";

// ---- 归一化映射 ----

interface DynastyNormalization {
  sourceDynasties: string[];
  targetDynasty: string;
  eraOverride?: (currentEra: string | undefined) => string | undefined;
}

const NORMALIZATION_RULES: DynastyNormalization[] = [
  // 汉：合并新朝、新莽末、楚汉之际、秦汉之际、汉末
  {
    sourceDynasties: ["新朝", "新莽末"],
    targetDynasty: "汉",
    eraOverride: () => "新朝",
  },
  {
    sourceDynasties: ["楚汉之际"],
    targetDynasty: "汉",
    eraOverride: (era) => era || "楚汉之际",
  },
  {
    sourceDynasties: ["秦汉之际"],
    targetDynasty: "汉",
    eraOverride: (era) => era || "秦末汉初",
  },
  {
    sourceDynasties: ["汉末"],
    targetDynasty: "汉",
    eraOverride: (era) => era || "东汉末",
  },

  // 三国：保留，三国演义单独一类
  {
    sourceDynasties: ["三国"],
    targetDynasty: "三国",
  },
  {
    sourceDynasties: ["三国演义"],
    targetDynasty: "三国演义",
  },

  // 晋：保留
  {
    sourceDynasties: ["晋"],
    targetDynasty: "晋",
  },

  // 南北朝：合并南朝、北魏
  {
    sourceDynasties: ["南朝", "北魏"],
    targetDynasty: "南北朝",
    eraOverride: (era) => era,
  },

  // 隋：合并隋唐之际
  {
    sourceDynasties: ["隋唐之际"],
    targetDynasty: "隋",
    eraOverride: (era) => era || "隋末唐初",
  },

  // 唐：合并五代
  {
    sourceDynasties: ["五代"],
    targetDynasty: "唐",
    eraOverride: () => "五代十国",
  },

  // 宋：合并宋辽、宋传奇、宋元之际
  {
    sourceDynasties: ["宋辽"],
    targetDynasty: "宋",
    eraOverride: () => "北宋",
  },
  {
    sourceDynasties: ["宋传奇"],
    targetDynasty: "宋",
    eraOverride: () => "南宋",
  },
  {
    sourceDynasties: ["宋元之际"],
    targetDynasty: "宋",
    eraOverride: () => "南宋末",
  },

  // 元：合并蒙古
  {
    sourceDynasties: ["蒙古"],
    targetDynasty: "元",
    eraOverride: (era) => era || "蒙古",
  },

  // 明：合并后金、明清之际
  {
    sourceDynasties: ["后金"],
    targetDynasty: "明",
    eraOverride: () => "明末",
  },
  {
    sourceDynasties: ["明清之际"],
    targetDynasty: "明",
    eraOverride: () => "明末清初",
  },

  // 清：合并清末
  {
    sourceDynasties: ["清末"],
    targetDynasty: "清",
    eraOverride: (era) => era || "晚清",
  },

  // 近代：保留
  {
    sourceDynasties: ["近代"],
    targetDynasty: "近代",
  },

  // 标准朝代直接保留
  { sourceDynasties: ["春秋"], targetDynasty: "春秋" },
  { sourceDynasties: ["战国"], targetDynasty: "战国" },
  { sourceDynasties: ["秦"], targetDynasty: "秦" },
  { sourceDynasties: ["汉"], targetDynasty: "汉" },
  { sourceDynasties: ["隋"], targetDynasty: "隋" },
  { sourceDynasties: ["唐"], targetDynasty: "唐" },
  { sourceDynasties: ["宋"], targetDynasty: "宋" },
  { sourceDynasties: ["明"], targetDynasty: "明" },
  { sourceDynasties: ["清"], targetDynasty: "清" },
];

function buildMapping(): Map<string, DynastyNormalization> {
  const map = new Map<string, DynastyNormalization>();
  for (const rule of NORMALIZATION_RULES) {
    for (const src of rule.sourceDynasties) {
      map.set(src, rule);
    }
  }
  return map;
}

// ---- 主流程 ----

const execute = process.argv.includes("--execute");
const mapping = buildMapping();

const rootDir = resolve(process.cwd(), EVENT_LIBRARY_ROOT_DIR);
const dynastyDirs = readdirSync(rootDir).filter((d) => {
  const stat = require("fs").statSync(join(rootDir, d));
  return stat.isDirectory();
});

interface MigrationItem {
  filePath: string;
  oldDynasty: string;
  oldEra: string | undefined;
  newDynasty: string;
  newEra: string | undefined;
  newDir: string;
  newPath: string;
  needsMove: boolean;
  needsUpdate: boolean;
}

const items: MigrationItem[] = [];
const skipped: { file: string; reason: string }[] = [];

for (const dynastyDir of dynastyDirs) {
  const dirPath = join(rootDir, dynastyDir);
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = parseEventLibraryFile(JSON.parse(raw)) as Record<string, unknown>;
      const oldDynasty = (parsed.dynasty as string) || dynastyDir;
      const oldEra = parsed.era as string | undefined;

      const rule = mapping.get(oldDynasty);
      if (!rule) {
        skipped.push({ file: filePath, reason: `无匹配规则: ${oldDynasty}` });
        continue;
      }

      const newDynasty = rule.targetDynasty;
      const newEra = rule.eraOverride ? rule.eraOverride(oldEra) : oldEra;
      const newDirSlug = toAsciiSlug(newDynasty);
      const newDir = join(rootDir, newDirSlug);
      const newPath = join(newDir, file);

      const needsMove = newDir !== dirPath;
      const needsUpdate = newDynasty !== oldDynasty || newEra !== oldEra;

      if (needsMove || needsUpdate) {
        items.push({
          filePath,
          oldDynasty,
          oldEra,
          newDynasty,
          newEra,
          newDir,
          newPath,
          needsMove,
          needsUpdate,
        });
      }
    } catch (e) {
      skipped.push({ file: filePath, reason: String(e) });
    }
  }
}

// 统计
console.log("=== 迁移计划 ===");
console.log(`待处理: ${items.length}`);
console.log(`跳过: ${skipped.length}`);
console.log("");

// 按目标朝代分组
const byTarget = new Map<string, MigrationItem[]>();
for (const item of items) {
  if (!byTarget.has(item.newDynasty)) byTarget.set(item.newDynasty, []);
  byTarget.get(item.newDynasty)!.push(item);
}

for (const [target, list] of byTarget) {
  console.log(`→ ${target} (${list.length} 条)`);
  for (const item of list.slice(0, 5)) {
    const parts = [];
    if (item.oldDynasty !== item.newDynasty) parts.push(`dynasty: ${item.oldDynasty} → ${item.newDynasty}`);
    if (item.oldEra !== item.newEra) parts.push(`era: ${item.oldEra ?? "(空)"} → ${item.newEra ?? "(空)"}`);
    const rel = item.filePath.replace(rootDir + "\\", "");
    console.log(`  ${rel}`);
    console.log(`    ${parts.join(", ")}`);
  }
  if (list.length > 5) console.log(`  ... 还有 ${list.length - 5} 条`);
  console.log("");
}

if (skipped.length > 0) {
  console.log("=== 跳过 ===");
  for (const s of skipped) {
    console.log(`  ${s.file}: ${s.reason}`);
  }
  console.log("");
}

if (!execute) {
  console.log("DRY-RUN 模式。加 --execute 执行实际迁移。");
  process.exit(0);
}

// ---- 执行迁移 ----

console.log("=== 执行迁移 ===");

let updated = 0;
let moved = 0;

for (const item of items) {
  // 读原始数据
  const raw = readFileSync(item.filePath, "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;

  // 更新 dynasty / era
  if (item.needsUpdate) {
    data.dynasty = item.newDynasty;
    if (item.newEra !== undefined) {
      data.era = item.newEra;
    }
  }

  let targetPath = item.filePath;

  // 移动到新目录
  if (item.needsMove) {
    if (!existsSync(item.newDir)) {
      mkdirSync(item.newDir, { recursive: true });
    }
    targetPath = item.newPath;
  }

  // 写入目标文件
  writeFileSync(targetPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  // 如果路径变了，删源文件
  if (item.needsMove && targetPath !== item.filePath) {
    const fs = require("fs");
    fs.unlinkSync(item.filePath);
    moved++;
  }

  if (item.needsUpdate) updated++;
}

// 清理空目录
for (const dynastyDir of dynastyDirs) {
  const dirPath = join(rootDir, dynastyDir);
  try {
    const entries = readdirSync(dirPath);
    if (entries.length === 0) {
      rmdirSync(dirPath);
      console.log(`删除空目录: ${dynastyDir}`);
    }
  } catch {
    // 已删除就跳过
  }
}

console.log("");
console.log("=== 完成 ===");
console.log(`更新字段: ${updated} 条`);
console.log(`移动文件: ${moved} 条`);
