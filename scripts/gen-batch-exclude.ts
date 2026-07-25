// 生成本批要处理的 exclude 列表（A 级中除目标 N 条外全部排除）
// 用法：node --import tsx scripts/gen-batch-exclude.ts <batchSize> <outputFile>
// 例如：node --import tsx scripts/gen-batch-exclude.ts 5 .tmp-batch1-exclude.txt
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "D:/ai_learn/story-forge/backend/assets/topic-libraries/historical-story.raw-topic-library.json";

const ALIAS_GROUPS: string[][] = [
  ["围魏救赵", "孙膑围魏救赵"],
  ["信陵君窃符救赵", "窃符救赵"],
  ["昭君出塞", "王昭君和亲"],
  ["成也萧何-败也萧何", "成也萧何，败也萧何", "成也萧何败也萧何"],
  ["昆阳之战", "昆阳大战王莽军"],
  ["煮酒论英雄", "青梅煮酒论英雄"],
  ["吕蒙白衣渡江", "白衣渡江"],
  ["王允连环计诛董卓", "貂蝉连环计"],
  ["周亚夫平七国之乱", "周亚夫平七国", "晁错削藩与七国之乱"],
  ["赵高指鹿为马", "指鹿为马"],
  ["秦王扫六合", "秦灭六国"],
  ["霍去病封狼居胥", "霍去病漠北远征"],
  ["土木之变", "土木堡之变"],
  ["戚继光台州大捷", "戚继光抗倭"],
  ["康熙擒鳌拜", "康熙智擒鳌拜"],
  ["戊戌变法", "戊戌政变", "百日维新"],
  ["辛亥革命武昌起义", "武昌起义"],
  ["诸葛亮空城计", "空城计"],
  ["乌台诗案", "苏轼乌台诗案"],
];

const batchSize = parseInt(process.argv[2] ?? "5", 10);
const outputFile = process.argv[3] ?? ".tmp-batch-exclude.txt";

const lib = JSON.parse(readFileSync(SOURCE, "utf8"));
const A = lib.items.filter((i) => i.priority === "A" && i.enabled !== false);

const done = new Set<string>();
const root = "storage/event-library";
for (const d of readdirSync(root)) {
  for (const f of readdirSync(join(root, d))) {
    done.add(f.replace(/\.json$/, ""));
  }
}
for (const group of ALIAS_GROUPS) {
  if (group.some((t) => done.has(t))) {
    group.forEach((t) => t && done.add(t));
  }
}

const remain = A.filter((i) => !done.has(i.title));
const batch = remain.slice(0, batchSize);
const batchTitles = new Set(batch.map((i) => i.title));

// 构造 exclude：A 级里所有非 batch 的标题（含已处理 + 别名组里的重复标题）
const exclude: string[] = [];
for (const item of A) {
  if (!batchTitles.has(item.title)) {
    exclude.push(item.title);
  }
}

console.log("本批处理:", batch.map((i) => `${i.title} [${i.dynasty}]`).join(" | "));
console.log("exclude 条数:", exclude.length);

writeFileSync(outputFile, exclude.join(","), "utf8");
console.log("已写入:", outputFile);
