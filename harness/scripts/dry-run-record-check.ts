/**
 * 审查记录一致性检查器（dry-run-record-check）。
 *
 * 背景：docs/records/2026-08-18-review-protocol-dry-run.md 在 R6-3/4/6/8/9/10/11/12
 * 八次出现"手改多行漏一行"的记录失真。本工具把候选/轮次/计数等对象收敛为事实表
 * （单一汇总点），对记录全文做机器核验；记录提交前必须运行本工具且全绿。
 *
 * 定位（重要）：核心逻辑是通用的 `checkRecordConsistency(content, facts)` 纯函数，
 * 可核验任意符合本格式约定的审查记录（复杂过程记录 ≥2 轮整改时建议使用）；
 * CLI 默认核验上述已封存的 dry-run 记录（DRY_RUN_FACTS），该记录已收尾终局，
 * 仅供防篡改回归。勿因文件名误以为只服务单条记录。
 *
 * 用法：
 *   npx tsx harness/scripts/dry-run-record-check.ts            # 核验封存 dry-run 记录
 *   npx tsx harness/scripts/dry-run-record-check.ts --record <path> --facts <path>
 *
 * 约定：facts JSON 结构同 RecordFacts（见下）；记录需包含候选表、轮表引用语、
 * R6 汇总句与计数行。表格行与"R6 实测"汇总行按构造是历史日志，活时态检查自动排除。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- 事实合同 -----------------------------------------------------------------

/** 单一事实源：核验一条审查记录所需的全部事实。改动记录时同步改这里。 */
export interface RecordFacts {
  maxCandidate: number;
  /** 待终审候选编号；已收尾终局（无待终审候选）时为 null。 */
  activeCandidate: number | null;
  /** 形成失败（收敛阶段失败、未进入终审）的候选编号。 */
  formationFailed: number[];
  /** 经 final 判失败的候选编号。 */
  finalFailed: number[];
  /** 经 final 通过但结论被后续事件失效的候选编号。 */
  finalPassedInvalidated: number[];
  /** 失效候选行必须携带的失效标记（如 "R6-7"）。 */
  invalidatedMarker: string;
  authorizations: number;
  finalsExecuted: number;
  r6Events: number;
  /** 轮 4 的迭代总数（含收尾落盘迭代）。 */
  iterations: number;
  /** R6 对应的已知缺陷对象是否已全部修复（未收尾状态下禁止残留留档表述）。 */
  knownDefectsFixed: boolean;
  /** 是否已收尾终局。 */
  closed: boolean;
  /** 收尾终局标记语（closed=true 时活文档必须包含）。 */
  closedMarker: string;
  /** "同模式N次复发"的事实值。 */
  samePatternRecurrences: number;
  /** "N次发生在不变量之后"的事实值。 */
  postInvariantRecurrences: number;
  /** 候选覆盖范围表述的起点（如"候选 5 至 N"）。 */
  coverageStartCandidate: number;
}

/** 封存 dry-run 记录（docs/records/2026-08-18-review-protocol-dry-run.md）的事实。 */
export const DRY_RUN_FACTS: RecordFacts = {
  maxCandidate: 13,
  activeCandidate: null,
  formationFailed: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
  finalFailed: [1],
  finalPassedInvalidated: [7],
  invalidatedMarker: "R6-7",
  authorizations: 6,
  finalsExecuted: 2,
  r6Events: 12,
  iterations: 10,
  knownDefectsFixed: true,
  closed: true,
  closedMarker: "接受现状收尾",
  samePatternRecurrences: 8,
  postInvariantRecurrences: 5,
  coverageStartCandidate: 5,
};

// --- 核心检查（纯函数） ---------------------------------------------------------

const CHINESE_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseChineseNumber(text: string): number | null {
  if (text.length === 1) return CHINESE_DIGITS[text] ?? null;
  if (text === "十") return 10;
  const match = /^十([一二三四五六七八九十])$/.exec(text);
  if (match) return 10 + CHINESE_DIGITS[match[1]!]!;
  return null;
}

function parseCount(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  return parseChineseNumber(text);
}

/**
 * 核验一条审查记录与事实表的一致性，返回全部失败项（空数组 = 通过）。
 * 检查族：C1 编号范围 / C2 活时态引用 / C3 R6 计数与条目 / C4 final 计数 /
 * C5 授权计数 / C6 迭代范围与行数 / C7 覆盖范围 / C8 候选表状态（含 active/closed）/
 * C9 终局表述 / C10 已知缺陷表述 / C11 自由文本计数锚定。
 */
export function checkRecordConsistency(content: string, facts: RecordFacts): string[] {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures.push(`[${name}] ${detail}`);
  };

  // 活文档行：排除 R6 历史汇总行与全部表格行（历史日志合法引用既往缺陷文本）。
  const liveContent = content
    .split("\n")
    .filter((line) => !line.includes("R6 实测") && !line.trimStart().startsWith("|"))
    .join("\n");

  // C1：候选编号不越界。
  for (const match of content.matchAll(/候选 (\d+)/g)) {
    const n = Number(match[1]);
    check("C1-candidate-range", n >= 1 && n <= facts.maxCandidate, `候选 ${n} 超出 1..${facts.maxCandidate}`);
  }

  // C2：活时态引用只允许指向当前候选。
  for (const pattern of [/待候选 (\d+) 收敛/g, /候选 (\d+) 终审为当前/g]) {
    for (const match of liveContent.matchAll(pattern)) {
      check("C2-active-tense", Number(match[1]) === facts.activeCandidate,
        `活时态引用指向候选 ${match[1]}（应为 ${facts.activeCandidate}）`);
    }
  }
  for (const match of liveContent.matchAll(/由候选 (\d+)(?:\/(\d+))? 重新收敛/g)) {
    const referenced = [Number(match[1]), ...(match[2] ? [Number(match[2])] : [])];
    for (const n of referenced) {
      check("C2-active-tense", n === facts.activeCandidate, `"由候选 ${n} 重新收敛"指向非当前候选`);
    }
  }

  // C3：R6 计数与条目一致。
  const r6CountMatch = /R6 实测([一二三四五六七八九十]+|\d+)次生效/.exec(content);
  check("C3-r6-count-stated", r6CountMatch !== null, "记录缺少“R6 实测N次生效”汇总句");
  if (r6CountMatch) {
    const stated = parseCount(r6CountMatch[1]!);
    check("C3-r6-count-value", stated === facts.r6Events, `R6 计数 ${stated} ≠ 事实 ${facts.r6Events}`);
  }
  const r6Bullet = content.split("\n").find((line) => line.includes("R6 实测") && line.includes("生效"));
  if (r6Bullet) {
    const ids = [...new Set([...r6Bullet.matchAll(/R6-(\d+)/g)].map((m) => Number(m[1])))];
    const expected = Array.from({ length: facts.r6Events }, (_, i) => i + 1);
    check("C3-r6-entries",
      ids.length === facts.r6Events && expected.every((id) => ids.includes(id)),
      `R6 条目集合 ${ids.join(",")} ≠ 期望覆盖 ${expected.join(",")}`);
  }

  // C4：final 计数。
  const finalCountMatch = /已执行 final 共 (\d+) 次/.exec(content);
  check("C4-final-count-stated", finalCountMatch !== null, "记录缺少“已执行 final 共 N 次”");
  if (finalCountMatch) {
    check("C4-final-count-value", Number(finalCountMatch[1]) === facts.finalsExecuted,
      `final 计数 ${finalCountMatch[1]} ≠ 事实 ${facts.finalsExecuted}`);
  }

  // C5：授权计数（所有“N 次授权”表述一致）。
  for (const match of content.matchAll(/(\d+) 次明确授权|(\d+) 次授权批次/g)) {
    const n = Number(match[1] ?? match[2]);
    check("C5-auth-count", n === facts.authorizations, `授权计数 ${n} ≠ 事实 ${facts.authorizations}`);
  }

  // C6：迭代范围（“迭代一至X”与轮表行数一致）。
  const rangeMatch = /迭代一至([一二三四五六七八九十]+)/.exec(liveContent);
  check("C6-iteration-range-stated", rangeMatch !== null, "记录缺少“迭代一至X”范围表述");
  const iterationRows = [...content.matchAll(/^\\?\|? *轮 4·迭代/gm)].length;
  check("C6-iteration-rows", iterationRows === facts.iterations, `轮表迭代行数 ${iterationRows} ≠ 事实 ${facts.iterations}`);
  if (rangeMatch) {
    const stated = parseChineseNumber(rangeMatch[1]!);
    check("C6-iteration-range-value", stated === facts.iterations,
      `“迭代一至${rangeMatch[1]}”（=${stated}）≠ 事实 ${facts.iterations}`);
  }

  // C7：候选覆盖范围（“候选 {start} 至 N”）。
  const coveragePattern = new RegExp(`候选 ${facts.coverageStartCandidate} 至 (\\d+)`, "g");
  for (const match of content.matchAll(coveragePattern)) {
    check("C7-coverage", Number(match[1]) === facts.maxCandidate,
      `覆盖范围“候选 ${facts.coverageStartCandidate} 至 ${match[1]}”≠ 事实 ${facts.maxCandidate}`);
  }

  // C8：候选表状态标注。
  for (const n of facts.formationFailed) {
    const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n}（`));
    check(`C8-status-${n}`, row !== undefined && row.includes("形成失败"), `候选 ${n} 行缺失或未标“形成失败”`);
  }
  for (const n of facts.finalFailed) {
    const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n} `) || line.startsWith(`| 候选 ${n}（`));
    check(`C8-final-failed-${n}`,
      row !== undefined && row.includes("final") && (row.includes("判失败") || row.includes("候选失败")),
      `候选 ${n} 行缺失或未标注 final 判失败（须含 final 与失败语义）`);
  }
  for (const n of facts.finalPassedInvalidated) {
    const row = content.split("\n").find((line) => line.startsWith(`| 候选 ${n}（`));
    check(`C8-invalidated-${n}`,
      row !== undefined && row.includes("终审通过") && row.includes(facts.invalidatedMarker),
      `候选 ${n} 行缺失或未标“终审通过 + ${facts.invalidatedMarker} 失效”`);
  }

  // C8-active/closed：待终审候选必须有表格行且带待终审标记；closed 终局时检查收尾标记。
  if (facts.activeCandidate !== null) {
    const activeRow = content.split("\n").find((line) => line.startsWith(`| 候选 ${facts.activeCandidate}（`));
    check("C8-active-row", activeRow !== undefined, `候选 ${facts.activeCandidate}（当前候选）表格行缺失`);
    check("C8-active-marker",
      activeRow !== undefined && (activeRow.includes("见终审结论") || activeRow.includes("待终审")),
      `候选 ${facts.activeCandidate} 行缺少待终审标记`);
  } else {
    check("C8-closed-marker", liveContent.includes(facts.closedMarker),
      `closed=true 但记录缺少收尾终局标记（${facts.closedMarker}）`);
  }

  // C10：已知缺陷修复状态表述一致。仅约束待终审状态（closed 终局时新留档对象
  // 合法使用"留档不再修复"表述）。
  if (facts.knownDefectsFixed && !facts.closed) {
    check("C10-known-defects",
      !liveContent.includes("留有已知瑕疵") && !liveContent.includes("留档不再修复"),
      "knownDefectsFixed=true 但记录仍残留留有已知瑕疵/留档不再修复陈旧表述");
  }

  // C11：自由文本 R6 计数锚定——"R6 N次拦截 / N次复发 / N次发生在"类计数表述
  // 必须与事实值一致（R6-12 盲区补丁；事实值全部来自 facts，无散落硬编码）。
  for (const match of liveContent.matchAll(/R6 ([一二三四五六七八九十\d]+)次拦截/g)) {
    const stated = parseCount(match[1]!);
    check("C11-r6-freetext", stated === facts.r6Events, `自由文本"R6 ${match[1]}次拦截" ≠ 事实 ${facts.r6Events}`);
  }
  for (const match of liveContent.matchAll(/同模式([一二三四五六七八九十\d]+)次复发/g)) {
    const stated = parseCount(match[1]!);
    check("C11-recurrence-freetext",
      stated === facts.samePatternRecurrences,
      `自由文本"同模式${match[1]}次复发" ≠ 事实 ${facts.samePatternRecurrences}`);
  }
  for (const match of liveContent.matchAll(/([一二三四五六七八九十\d]+)次发生在(?:不变量|grep 不变量|不变量\/脚本)/g)) {
    const stated = parseCount(match[1]!);
    check("C11-post-invariant-freetext",
      stated === facts.postInvariantRecurrences,
      `自由文本"${match[1]}次发生在不变量" ≠ 事实 ${facts.postInvariantRecurrences}`);
  }

  // C9：待终审候选存在时禁"无有效通过终审"；closed 终局时禁残留待终审活引用。
  if (facts.activeCandidate !== null) {
    check("C9-terminal-claim", !content.includes("无有效通过终审"),
      `${facts.activeCandidate} 待终审，不得残留“无有效通过终审”终局表述`);
  } else {
    // 裸词"待终审"可作为模式名被合法引用（如盲区清单），只锚定完整陈旧语序。
    check("C9-closed-stale",
      !liveContent.includes("终审为当前待执行的有效终审") && !liveContent.includes("候选 1 待终审") && !liveContent.includes("候选 11 待终审"),
      "closed=true 但活文档仍残留待终审活引用");
  }

  return failures;
}

// --- CLI 入口 -------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const recordFlag = args.indexOf("--record");
  const factsFlag = args.indexOf("--facts");
  const recordPath = recordFlag >= 0 ? resolve(args[recordFlag + 1]!) : resolve("docs/records/2026-08-18-review-protocol-dry-run.md");
  const facts: RecordFacts = factsFlag >= 0 ? JSON.parse(readFileSync(resolve(args[factsFlag + 1]!), "utf8")) : DRY_RUN_FACTS;

  const content = readFileSync(recordPath, "utf8");
  const failures = checkRecordConsistency(content, facts);
  if (failures.length > 0) {
    console.error(`审查记录一致性检查失败（${failures.length} 项）：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`审查记录一致性检查通过（候选 ≤${facts.maxCandidate}、授权 ${facts.authorizations}、final ${facts.finalsExecuted}、R6 ${facts.r6Events}、迭代 ${facts.iterations}）。`);
}

// 被 vitest 导入时不执行 CLI。
if (process.env.VITEST === undefined) {
  main();
}
