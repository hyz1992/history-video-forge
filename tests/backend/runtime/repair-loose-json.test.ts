import { describe, expect, it } from "vitest";

import { repairLooseJson } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";

function parsesAsJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

describe("repairLooseJson", () => {
  it("passes through strict JSON unchanged", () => {
    const input = '{"a":1,"b":[2,3]}';
    expect(repairLooseJson(input)).toBe(input);
    expect(parsesAsJson(repairLooseJson(input))).toBe(true);
  });

  it("repairs trailing comma in object", () => {
    const input = '{"a":1,"b":2,}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: 2 });
  });

  it("repairs trailing comma in nested array", () => {
    const input = '{"items":[1,2,3,]}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ items: [1, 2, 3] });
  });

  it("repairs missing closing curly bracket", () => {
    const input = '{"a":1,"b":{"c":2';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: { c: 2 } });
  });

  it("repairs missing closing square bracket", () => {
    const input = '{"items":[1,2,3';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ items: [1, 2, 3] });
  });

  it("repairs Chinese punctuation (commas and colons)", () => {
    const input = '{"名字"："张三"，"年龄"：18}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ 名字: "张三", 年龄: 18 });
  });

  it("repairs Chinese double quotes", () => {
    const input = '{"desc":"这是一个“测试”场景"}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
  });

  it("repairs unclosed string literal by appending a quote", () => {
    const input = '{"a":"unclosed string}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
  });

  it("repairs missing comma between object properties (real-world LLM error: Expected ',' or '}' after property value)", () => {
    // 对应错误消息 "Expected ',' or '}' after property value at position 1224"
    const input = '{"a":"value1" "b":"value2"}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ a: "value1", b: "value2" });
  });

  it("repairs missing comma between number value and string key", () => {
    const input = '{"count":3 "label":"x"}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
    expect(JSON.parse(repaired)).toEqual({ count: 3, label: "x" });
  });

  it("repairs missing comma after nested object/array", () => {
    const input = '{"inner":{"x":1} "label":"y"}';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
  });

  it("handles code-fenced JSON-like content inside repairLooseJson (fence stripping is upstream)", () => {
    // repairLooseJson 只负责语法修复，fence 由 recoverJsonCandidate 上层处理
    const input = '{"a":1,';
    const repaired = repairLooseJson(input);
    expect(parsesAsJson(repaired)).toBe(true);
  });
});
