import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  LlmOutputError,
  parseLlmOutput,
} from "../../../backend/src/runtime/llm/llm-output-error.js";

const schema = z.object({ name: z.string() });

describe("LlmOutputError", () => {
  it("carries a stable code and the LlmOutputError name", () => {
    const error = new LlmOutputError("storyboard_plan_schema_invalid");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LlmOutputError");
    expect(error.code).toBe("storyboard_plan_schema_invalid");
    expect(error.message).toBe("storyboard_plan_schema_invalid");
  });

  it("preserves the cause passed via options", () => {
    const issues = [{ path: ["name"], message: "required" }];
    const error = new LlmOutputError("storyboard_plan_schema_invalid", {
      cause: issues,
    });
    expect(error.cause).toEqual(issues);
  });
});

describe("parseLlmOutput", () => {
  it("returns the parsed value on the success path", () => {
    const parsed = parseLlmOutput(schema, { name: "晏子" }, "ok_code");
    expect(parsed).toEqual({ name: "晏子" });
  });

  it("wraps a ZodError into an LlmOutputError with the given code", () => {
    try {
      parseLlmOutput(schema, { name: 123 }, "storyboard_plan_schema_invalid");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      if (error instanceof LlmOutputError) {
        expect(error.code).toBe("storyboard_plan_schema_invalid");
        expect(Array.isArray(error.cause)).toBe(true);
      }
    }
  });

  it("rethrows non-ZodError exceptions unchanged", () => {
    const throwingSchema = {
      parse() {
        throw new Error("boom");
      },
      safeParse() {
        throw new Error("boom");
      },
    } as unknown as z.ZodType<unknown>;
    expect(() =>
      parseLlmOutput(throwingSchema, {}, "any_code"),
    ).toThrow("boom");
  });

  it("preserves ZodError issues on the wrapped error cause", () => {
    try {
      parseLlmOutput(schema, {}, "script_draft_schema_invalid");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      if (error instanceof LlmOutputError) {
        const cause = error.cause as Array<{ path: PropertyKey[]; message: string }>;
        expect(cause.length).toBeGreaterThan(0);
        expect(cause[0]?.path).toContain("name");
      }
    }
  });

  it("is distinguishable via instanceof from generic Errors", () => {
    try {
      parseLlmOutput(schema, { wrong: 1 }, "storyboard_segment_schema_invalid");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error instanceof LlmOutputError).toBe(true);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof z.ZodError).toBe(false);
    }
  });

  it("strips unknown top-level keys from LLM output", () => {
    const parsed = parseLlmOutput(
      schema,
      { name: "晏子", unexpected_field: "should be removed" },
      "ok_code",
    );
    expect(parsed).toEqual({ name: "晏子" });
  });

  it("strips unknown keys at nested levels and inside array elements", () => {
    const nested = z
      .object({
        tasks: z.array(
          z.object({
            id: z.string(),
            policy: z.object({ allowed: z.boolean() }).strict(),
          }).strict(),
        ),
        budget: z.array(z.string()),
      })
      .strict();
    const raw = {
      tasks: [
        { id: "t1", policy: { allowed: false }, extra_task_field: true },
        { id: "t2", policy: { allowed: true, extra_policy_field: 1 } },
      ],
      budget: ["a"],
      top_level_unknown: 42,
    };
    const parsed = parseLlmOutput(nested, raw, "ok_code");
    expect(parsed).toEqual({
      tasks: [
        { id: "t1", policy: { allowed: false } },
        { id: "t2", policy: { allowed: true } },
      ],
      budget: ["a"],
    });
  });

  it("still throws when a required field is missing after stripping unknowns", () => {
    try {
      parseLlmOutput(schema, { name: "ok", extra: 1 }, "should_not_throw");
      // 上面 name 存在，extra 被剥离，应该成功；这里验证剥离后缺失必填仍抛错
    } catch {
      // 不应进到这里
      throw new Error("should not throw when only unknowns present");
    }
    // 真正缺失必填字段
    expect(() =>
      parseLlmOutput(schema, { extra: 1 }, "missing_required"),
    ).toThrow(LlmOutputError);
  });
});
