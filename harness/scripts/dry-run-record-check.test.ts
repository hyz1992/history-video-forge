import { describe, expect, it } from "vitest";

import { checkRecordConsistency, DRY_RUN_FACTS } from "./dry-run-record-check.ts";

/**
 * S2-2A 协议 dry-run 记录一致性检查器的单元测试。
 *
 * 覆盖：核心检查函数的通过/篡改检测矩阵（Claude Code 审核 P1-2 补齐）、
 * C8-final-failed 断言强度（P2-5 假阴性回归）、FACTS 全收敛（P2-3）、closed 模式。
 */

const CN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"];

function minimalRecord(facts: typeof DRY_RUN_FACTS): string {
  return [
    `轮计数：用户共 ${facts.authorizations} 次明确授权，对应轮表"轮 4·迭代一至${CN[facts.iterations]}"，覆盖候选 5 至 ${facts.maxCandidate} 迭代。`,
    "",
    "| 候选 | 提交 | 编排 | 结论 |",
    "|---|---|---|---|",
    ...facts.finalFailed.map((n) => `| 候选 ${n} | c${n} | final 两阶段 | final 阶段二发现 Important → 候选失败 |`),
    ...facts.formationFailed.map((n) => `| 候选 ${n}（形成失败） | c${n} | diff+contract | 判失败，未形成候选 |`),
    ...facts.finalPassedInvalidated.map((n) => `| 候选 ${n}（终审通过） | c${n} | final 两阶段 | 终审通过后 ${facts.invalidatedMarker} 失效 |`),
    "",
    "| 轮 | 整改 | 复审 | 结果 |",
    "|---|---|---|---|",
    ...Array.from({ length: facts.iterations }, (_, i) => `| 轮 4·迭代${i + 1} | c${i} | diff+contract | 见结论 |`),
    "",
    `- R6 实测${facts.r6Events}次生效：${Array.from({ length: facts.r6Events }, (_, i) => `R6-${i + 1}`).join("；")}。`,
    `已执行 final 共 ${facts.finalsExecuted} 次。`,
    `同模式${facts.samePatternRecurrences}次复发，其中${facts.postInvariantRecurrences}次发生在不变量之后。`,
    "R6 十二次拦截。",
    "接受现状收尾，无有效通过终审。",
  ].join("\n");
}

describe("dry-run-record-check 核心函数", () => {
  it("DRY_RUN_FACTS 对应的最小合法记录通过全部检查", () => {
    const failures = checkRecordConsistency(minimalRecord(DRY_RUN_FACTS), DRY_RUN_FACTS);
    expect(failures).toEqual([]);
  });

  it("候选编号越界被拦截（C1）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS) + "\n候选 14 出现在活文档。";
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C1-candidate-range"))).toBe(true);
  });

  it("活时态引用指向非当前候选被拦截（C2）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS) + "\n待候选 3 收敛后执行。";
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C2-active-tense"))).toBe(true);
  });

  it("R6 汇总计数与 FACTS 不符被拦截（C3）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace("R6 实测12次生效", "R6 实测11次生效");
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C3-r6-count-value"))).toBe(true);
  });

  it("final 计数不符被拦截（C4）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace("已执行 final 共 2 次", "已执行 final 共 3 次");
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C4-final-count-value"))).toBe(true);
  });

  it("授权计数不符被拦截（C5）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace("共 6 次明确授权", "共 5 次明确授权");
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C5-auth-count"))).toBe(true);
  });

  it("同模式复发计数来自 FACTS 而非硬编码（C11，P2-3 回归）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace("同模式8次复发", "同模式7次复发");
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C11-recurrence-freetext"))).toBe(true);
    // 反向：修改 facts 中的复发数后，原记录应失败——证明该值由 facts 驱动。
    const factsVariant = { ...DRY_RUN_FACTS, samePatternRecurrences: 7 };
    const failuresVariant = checkRecordConsistency(minimalRecord(DRY_RUN_FACTS), factsVariant);
    expect(failuresVariant.some((f) => f.includes("C11-recurrence-freetext"))).toBe(true);
  });

  it("发生在不变量之后的计数来自 FACTS（C11，P2-3 回归）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace("其中5次发生在不变量", "其中4次发生在不变量");
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C11-post-invariant-freetext"))).toBe(true);
    const factsVariant = { ...DRY_RUN_FACTS, postInvariantRecurrences: 4 };
    const failuresVariant = checkRecordConsistency(minimalRecord(DRY_RUN_FACTS), factsVariant);
    expect(failuresVariant.some((f) => f.includes("C11-post-invariant-freetext"))).toBe(true);
  });

  it("失效标记来自 FACTS 而非硬编码 R6-7（C8-invalidated，P2-3 回归）", () => {
    const factsVariant = { ...DRY_RUN_FACTS, invalidatedMarker: "R6-99", finalPassedInvalidated: [7] };
    const failures = checkRecordConsistency(minimalRecord(DRY_RUN_FACTS), factsVariant);
    expect(failures.some((f) => f.includes("C8-invalidated-7"))).toBe(true);
  });

  it("收尾标记来自 FACTS（C8-closed，P2-3 回归）", () => {
    const factsVariant = { ...DRY_RUN_FACTS, closedMarker: "另一种收尾" };
    const failures = checkRecordConsistency(minimalRecord(DRY_RUN_FACTS), factsVariant);
    expect(failures.some((f) => f.includes("C8-closed-marker"))).toBe(true);
  });

  it("C8-final-failed 断言强度：行含 final 但无失败语义被拦截（P2-5 假阴性回归）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS).replace(
      "| 候选 1 | c1 | final 两阶段 | final 阶段二发现 Important → 候选失败 |",
      "| 候选 1 | c1 | final 两阶段 | final 一切顺利通过 |",
    );
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C8-final-failed-1"))).toBe(true);
  });

  it("closed 终局残留待终审活引用被拦截（C9-closed-stale）", () => {
    const mutated = minimalRecord(DRY_RUN_FACTS) + "\n候选 1 终审为当前待执行的有效终审。";
    const failures = checkRecordConsistency(mutated, DRY_RUN_FACTS);
    expect(failures.some((f) => f.includes("C9-closed-stale"))).toBe(true);
  });

  it("陈旧语序锚来自 FACTS 而非硬编码（C9，P2-3 回归）", () => {
    const factsVariant = { ...DRY_RUN_FACTS, staleActiveTenseAnchors: ["另一种陈旧语序"] };
    const mutated = minimalRecord(factsVariant) + "\n另一种陈旧语序";
    const failures = checkRecordConsistency(mutated, factsVariant);
    expect(failures.some((f) => f.includes("C9-closed-stale"))).toBe(true);
    // 原锚在变体 facts 下不再触发（证明由 facts 驱动）。
    const baseRecord = minimalRecord(factsVariant) + "\n候选 11 待终审";
    const failuresBase = checkRecordConsistency(baseRecord, factsVariant);
    expect(failuresBase.some((f) => f.includes("C9-closed-stale"))).toBe(false);
  });

  it("待终审模式：active 候选存在时 C9 禁止无有效通过终审表述", () => {
    const openFacts = { ...DRY_RUN_FACTS, activeCandidate: 14, closed: false, maxCandidate: 14 };
    const record = minimalRecord(openFacts)
      .replace("接受现状收尾，无有效通过终审。", "候选 14 待终审，见终审结论。")
      + "\n| 候选 14（见终审结论） | c14 | diff+contract | 见终审结论 |\n";
    const failures = checkRecordConsistency(record, openFacts);
    expect(failures.filter((f) => !f.includes("C6-iteration-rows") && !f.includes("C7-coverage"))).toEqual([]);
    // 反向：待终审状态残留"无有效通过终审"被 C9 拦截。
    const mutated = record.replace("候选 14 待终审，见终审结论。", "候选 14 待终审，无有效通过终审。");
    const failuresMutated = checkRecordConsistency(mutated, openFacts);
    expect(failuresMutated.some((f) => f.includes("C9-terminal-claim"))).toBe(true);
  });
});
