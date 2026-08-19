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
  maxCandidate: 13,
  /** dry-run 已收尾终局（无待终审候选）时为 null。 */
  activeCandidate: null,
  /** 形成失败（formation_failed）的候选编号。 */
  formationFailed: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
  /** 经 final 判失败的候选。 */
  finalFailed: [1],
  /** 经 final 通过但结论被后续事件失效的候选。 */
  finalPassedInvalidated: [7],
  authorizations: 6,
  finalsExecuted: 2,
  r6Events: 12,
  /** 轮 4 的迭代总数（含收尾落盘迭代十）。 */
  iterations: 10,
  /** R6-10/R6-11/R6-12 对象是否已全部修复（修复后记录不得残留"留有已知瑕疵"表述）。 */
  knownDefectsFixed: true,
  /** dry-run 是否已收尾终局。 */
  closed: true,
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

// C8-active：待终审候选必须有表格行且带待终审标记；closed 终局时检查收尾标记。
if (FACTS.activeCandidate !== null) {
  const activeRow = content.split("\n").find((line) => line.startsWith(`| 候选 ${FACTS.activeCandidate}（`));
  check("C8-active-row", activeRow !== undefined, `候选 ${FACTS.activeCandidate}（当前候选）表格行缺失`);
  check("C8-active-marker", activeRow !== undefined && (activeRow.includes("见终审结论") || activeRow.includes("待终审")),
    `候选 ${FACTS.activeCandidate} 行缺少待终审标记`);
} else {
  check("C8-closed-marker", liveContent.includes("接受现状收尾"),
    "closed=true 但记录缺少收尾终局标记（接受现状收尾）");
}

// C10：已知缺陷修复状态表述一致。仅约束待终审状态（closed 终局时 R6-13/14 等
// 新留档对象合法使用"留档不再修复"表述）。
if (FACTS.knownDefectsFixed && !FACTS.closed) {
  check("C10-known-defects", !liveContent.includes("留有已知瑕疵") && !liveContent.includes("留档不再修复"),
    "knownDefectsFixed=true 但记录仍残留留有已知瑕疵/留档不再修复陈旧表述");
}

// C11：自由文本 R6 计数锚定——活文档中"R6 N次拦截 / N次复发 / N次发生在"类
// 计数表述必须与 FACTS.r6Events 及同模式复发次数一致（R6-12 盲区补丁）。
const SAME_PATTERN_RECURRENCES = 8;
for (const match of liveContent.matchAll(/R6 ([一二三四五六七八九十\d]+)次拦截/g)) {
  const stated = /^\d+$/.test(match[1]!) ? Number(match[1]!) : parseChineseNumber(match[1]!);
  check("C11-r6-freetext", stated === FACTS.r6Events, `自由文本"R6 ${match[1]}次拦截" ≠ 事实 ${FACTS.r6Events}`);
}
for (const match of liveContent.matchAll(/同模式([一二三四五六七八九十\d]+)次复发/g)) {
  const stated = /^\d+$/.test(match[1]!) ? Number(match[1]!) : parseChineseNumber(match[1]!);
  check("C11-recurrence-freetext", stated === SAME_PATTERN_RECURRENCES, `自由文本"同模式${match[1]}次复发" ≠ 事实 ${SAME_PATTERN_RECURRENCES}`);
}
for (const match of liveContent.matchAll(/([一二三四五六七八九十\d]+)次发生在(?:不变量|grep 不变量|不变量\/脚本)/g)) {
  const stated = /^\d+$/.test(match[1]!) ? Number(match[1]!) : parseChineseNumber(match[1]!);
  check("C11-post-invariant-freetext", stated === 5, `自由文本"${match[1]}次发生在不变量" ≠ 事实 5`);
}

// C9：待终审候选存在时禁"无有效通过终审"；closed 终局时禁残留待终审活引用。
if (FACTS.activeCandidate !== null) {
  check("C9-terminal-claim", !content.includes("无有效通过终审"),
    FACTS.activeCandidate + " 待终审，不得残留“无有效通过终审”终局表述");
} else {
  // 注意：裸词"待终审"可作为模式名被合法引用（如 C2 盲区清单），只锚定完整陈旧语序。
  check("C9-closed-stale", !liveContent.includes("终审为当前待执行的有效终审") && !liveContent.includes("候选 11 待终审"),
    "closed=true 但活文档仍残留待终审活引用");
}

// 输出。
if (failures.length > 0) {
  console.error(`dry-run 记录一致性检查失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`dry-run 记录一致性检查通过（候选 ≤${FACTS.maxCandidate}、授权 ${FACTS.authorizations}、final ${FACTS.finalsExecuted}、R6 ${FACTS.r6Events}、迭代 ${FACTS.iterations}）。`);
