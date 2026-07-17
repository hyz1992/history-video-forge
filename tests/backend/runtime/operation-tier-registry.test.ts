import { describe, expect, it, vi } from "vitest";

import {
  getOperationTier,
  OPERATION_TIER_REGISTRY,
  type OperationTier,
} from "../../../backend/src/runtime/llm/operation-tier-registry.js";

describe("operation tier registry", () => {
  describe("smart tier operations", () => {
    const smartOperations: ReadonlyArray<keyof typeof OPERATION_TIER_REGISTRY> = [
      "script.writer",
      "storyboard.planner",
      "storyboard.segment-regen",
      "topic.candidate-builder",
      "topic.candidate-builder-repair",
      "asset-planning.planner",
      "asset-planning.asset-structural-repair",
      "topic.selector",
      "script.semantic-reviewer",
    ];

    for (const operation of smartOperations) {
      it(`registers ${operation} as smart`, () => {
        expect(OPERATION_TIER_REGISTRY[operation]).toBe("smart");
        expect(getOperationTier(operation)).toBe("smart");
      });
    }
  });

  describe("flash tier operations", () => {
    const flashOperations: ReadonlyArray<keyof typeof OPERATION_TIER_REGISTRY> = [
      "publish.title-generator",
      "publish.description-generator",
      "publish.cover-prompt-generator",
      "publish.cover-prompt-optimizer",
      "asset.prompt-optimizer",
    ];

    for (const operation of flashOperations) {
      it(`registers ${operation} as flash`, () => {
        expect(OPERATION_TIER_REGISTRY[operation]).toBe("flash");
        expect(getOperationTier(operation)).toBe("flash");
      });
    }
  });

  it("topic.selector must always be smart (critical constraint from S2-0)", () => {
    expect(getOperationTier("topic.selector")).toBe("smart");
  });

  it("registry covers all 14 expected operations", () => {
    expect(Object.keys(OPERATION_TIER_REGISTRY).sort()).toEqual(
      [
        "script.writer",
        "storyboard.planner",
        "storyboard.segment-regen",
        "topic.candidate-builder",
        "topic.candidate-builder-repair",
        "asset-planning.planner",
        "asset-planning.asset-structural-repair",
        "topic.selector",
        "script.semantic-reviewer",
        "publish.title-generator",
        "publish.description-generator",
        "publish.cover-prompt-generator",
        "publish.cover-prompt-optimizer",
        "asset.prompt-optimizer",
      ].sort(),
    );
  });

  it("topic.light-review is NOT in registry (removed in S2-0 rollback)", () => {
    expect(OPERATION_TIER_REGISTRY).not.toHaveProperty("topic.light-review");
  });

  describe("unknown operations default to smart", () => {
    it("returns smart for completely unknown operation", () => {
      expect(getOperationTier("unknown.op")).toBe("smart");
    });

    it("returns smart for topic.light-review (removed from production)", () => {
      expect(getOperationTier("topic.light-review")).toBe("smart");
    });

    it("returns smart for empty string", () => {
      expect(getOperationTier("")).toBe("smart");
    });
  });

  describe("OperationTier type", () => {
    it("only allows smart and flash values", () => {
      const tiers = new Set<OperationTier>(["smart", "flash"]);
      expect(tiers.size).toBe(2);
      expect([...tiers].sort()).toEqual(["flash", "smart"]);
    });
  });

  describe("warned operations caching", () => {
    it("does not throw on repeated unknown operation lookups", () => {
      expect(() => {
        getOperationTier("repeated.unknown");
        getOperationTier("repeated.unknown");
        getOperationTier("repeated.unknown");
      }).not.toThrow();
    });

    it("emits a warning exactly once per unknown operation (warnedOperations cache)", () => {
      // 用本测试独有的 operation 名，避免与其他用例累积的 warnedOperations 冲突。
      const uniqueOp = "warning.test.unique.op";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        getOperationTier(uniqueOp);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(uniqueOp);

        // 同一未知 operation 第二次调用：warnedOperations 命中缓存，不再触发 warning。
        getOperationTier(uniqueOp);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        // 另一个新未知 operation 仍会触发一次新的 warning。
        const anotherOp = "warning.test.another.op";
        getOperationTier(anotherOp);
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[1][0]).toContain(anotherOp);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
