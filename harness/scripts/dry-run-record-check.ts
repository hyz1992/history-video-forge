/**
 * dry-run 记录一致性检查脚本（单一事实源核验）。
 *
 * 背景：docs/records/2026-08-18-review-protocol-dry-run.md 在 R6-3/4/6/8/9/10 六次
 * 出现"手改多行漏一行"的记录失真。本脚本把候选/轮次/计数等对象收敛为嵌入式
 * 事实表（单一汇总点），对记录全文做机器核验；记录提交前必须运行本脚本且全绿。
 *
 * 用法：npx tsx harness/scripts/dry-run-record-check.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RECORD_PATH = resolve(process.cwd(), "docs/records/2026-08-18-review-protocol-dry-run.md");

/** 单一事实源：新增候选/授权/迭代时只改这里，脚本据此核验记录。 */
const FACTS = {
  maxCandidate: 11,
  activeCandidate: 11,
  /** 形成失败（formation_failed）的候选编号。 */
  formationFailed: [2, 3, 4, 5, 6, 8, 9, 10],
  /** 经 final 判失败的候选。 */
  finalFailed: [1],
  /** 经 final 通过但结论被后续事件失效的候选。 */
  finalPassedInvalidated: [7],
  authorizations: 5,
  finalsExecuted: 2,
  r6Events: 10,
  /** 轮 4 的迭代总数。 */
  iterations: 7,
};

const CHINESE_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseNumber(text: string): number | null {
  if (text.length === 1) return CHINESE_DIGITS[text] ?? null;
  if (text === "十") return 10;
  const match = /^十([一二三四五六七八九])$/.exec(text);
  if (match) return 10 + CHINESE_DIGITS[match[1]!]!;
  return null;
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures.push(`[${name}] ${detail}`);
}

const content = readFileSync(RECORD_PATH, "utf8");
// 活文档行：排除 R6 历史汇总行与全部表格行（候选表/轮表行按构造是历史日志，
// 其结论单元合法引用既往缺陷文本如"待候选 X 收敛"，不属于活时态引用）。
const liveLines = content.split("\n").filter(
  (line) => !line.includes("R6 实测") && !line.trimStart().startsWith("|"),
);
const liveContent = liveLines.join("\n");

// C1：候选编号不越界。
for (const match of content.matchAll(/候选 (\d+)/g)) {
  const n = Number(match[1]);
  check("C1-candidate-range", n >= 1 && n <= FACTS.maxCandidate, `候选 ${n} 超出 1..${FACTS.maxCandidate}`);
}

// C2：活时态引用只允许指向当前候选。
for (const pattern of [/待候选 (\d+) 收敛/g, /候选 (\d+) 终审为当前/g]) {
  for (const match of liveContent.matchAll(pattern)) {
    check("C2-active-tense", Number(match[1]) === FACTS.activeCandidate,
      `活时态引用指向候选 ${match[1]}（应为 ${FACTS.activeCandidate}）`);
  }
}
for (const match of liveContent.matchAll(/由候选 (\d+)(?:\/(\d+))? 重新收敛/g)) {
  const referenced = [Number(match[1]), ...(match[2] ? [Number(match[2])] : [])];
  for (const n of referenced) {
    check("C2-active-tense", n === FACTS.activeCandidate, `“由候选 ${n} 重新收敛”指向非当前候选`);
  }
}

// C3：R6 计数与条目一致。
const r6CountMatch = /R6 实测([一二三四五六七八九十]+|\d+)次生效/.exec(content);
check("C3-r6-count-stated", r6CountMatch !== null, "记录缺少“R6 实测N次生效”汇总句");
if (r6CountMatch) {
  const stated = /^\d+$/.test(r6CountMatch[1]!) ? Number(r6CountMatch[1]) : parseChineseNumber(r6CountMatch[1]!);
  check("C3-r6-count-value", stated === FACTS.r6Events, `R6 计数 ${stated} ≠ 事实 ${FACTS.r6Events}`);
}
const r6Bullet = content.split("\n").find((line) => line.includes("R6 实测") && line.includes("生效"));
if (r6Bullet) {
  const ids = [...new Set([...r6Bullet.matchAll(/R6-(\d+)/g)].map((m) => Number(m[1])))];
  const expected = Array.from({ length: FACTS.r6Events }, (_, i) => i + 1);
  check("C3-r6-entries",
    ids.length === FACTS.r6Events && expected.every((id) => ids.includes(id)),
    `R6 条目集合 ${ids.join(",")} ≠ 期望覆盖 ${expected.join(",")}`);
}

// C4：final 计数。
const finalCountMatch = /已执行 final 共 (\d+) 次/.exec(content);
check("C4-final-count-stated", finalCountMatch !== null, "记录缺少“已执行 final 共 N 次”");
if (finalCountMatch) {
  check("C4-final-count-value", Number(finalCountMatch[1]) === FACTS.finalsExecuted,
    `final 计数 ${finalCountMatch[1]} ≠ 事实 ${FACTS.finalsExecuted}`);
}

// C5：授权计数（所有“N 次授权”表述一致）。
for (const match of content.matchAll(/(\d+) 次明确授权|(\d+) 次授权批次/g)) {
  const n = Number(match[1] ?? match[2]);
  check("C5-auth-count", n === FACTS.authorizations, `授权计数 ${n} ≠ 事实 ${FACTS.authorizations}`);
}

// C6：迭代范围（“迭代一至X”与轮表行数一致）。
const rangeMatch = /迭代一至([一二三四五六七八九十]+)/.exec(liveContent);
check("C6-iteration-range-stated", rangeMatch !== null, "记录缺少“迭代一至X”范围表述");
const iterationRows = [...content.matchAll(/^\\?\|? *轮 4·迭代/gm)].length;
check("C6-iteration-rows", iterationRows === FACTS.iterations, `轮表迭代行数 ${iterationRows} ≠ 事实 ${FACTS.iterations}`);
if (rangeMatch) {
  const stated = parseChineseNumber(rangeMatch[1]!);
  check("C6-iteration-range-value", stated === FACTS.iterations,
    `“迭代一至${rangeMatch[1]}”（=${stated}）≠ 事实 ${FACTS.iterations}`);
}

// C7：候选覆盖范围（“候选 5 至 N”）。
for (const match of content.matchAll(/候选 5 至 (\d+)/g)) {
  check("C7-coverage", Number(match[1]) === FACTS.maxCandidate,
    `覆盖范围“候选 5 至 ${match[1]}”≠ 事实 ${FACTS.maxCandidate}`);
}

// C8：候选表状态标注。
for (const n of FACTS.formationFailed) {
  const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n}（`));
  check(`C8-status-${n}`, row !== undefined && row.includes("形成失败"), `候选 ${n} 行缺失或未标“形成失败”`);
}
for (const n of FACTS.finalFailed) {
  const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n} `) || line.startsWith(`| 候选 ${n}（`));
  check(`C8-final-failed-${n}`, row !== undefined && row.includes("final"), `候选 ${n} 行缺失或未标 final 判失败`);
}
for (const n of FACTS.finalPassedInvalidated) {
  const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n}（`));
  check(`C8-invalidated-${n}`, row !== undefined && row.includes("终审通过") && row.includes("R6-7"),
    `候选 ${n} 行缺失或未标“终审通过 + R6-7 失效”`);
}

// C9：终止性表述不再宣称“终局/无有效终审”（候选 11 存在时）。
if (FACTS.activeCandidate === FACTS.maxCandidate) {
  check("C9-terminal-claim", !content.includes("无有效通过终审"),
    "候选 11 待终审，不得残留“无有效通过终审”终局表述");
}

// 输出。
if (failures.length > 0) {
  console.error(`dry-run 记录一致性检查失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`dry-run 记录一致性检查通过（候选 ≤${FACTS.maxCandidate}、授权 ${FACTS.authorizations}、final ${FACTS.finalsExecuted}、R6 ${FACTS.r6Events}、迭代 ${FACTS.iterations}）。`);
