import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { AssetPlan } from "../../../shared/src/index.js";
import {
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
} from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import { buildIntentCompilerShadowReport } from "../../../backend/src/modules/asset-planning/asset-plan-intent-shadow.js";

const fixture = JSON.parse(readFileSync(new URL(
  "../../fixtures/asset-planning/intent-compiler-shadow-golden.json",
  import.meta.url,
), "utf8")) as { legacyPlan: unknown; compilerInput: AssetPlanCompilerInput };

function projectRelativeSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]!).filter((specifier) => specifier.startsWith("."));
}

const FORBIDDEN_BUILTIN_SPECIFIERS = new Set([
  "node:fs", "node:fs/promises", "node:net", "node:http", "node:https",
  "node:child_process", "fs", "fs/promises", "net", "http", "https",
  "child_process",
]);

function forbiddenBuiltinSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
  ].map((match) => match[1]!).filter((specifier) =>
    FORBIDDEN_BUILTIN_SPECIFIERS.has(specifier),
  );
}

function forbiddenClosureEntries(entries: string[]): string[] {
  return entries.filter((entry) => FORBIDDEN_BUILTIN_SPECIFIERS.has(entry));
}

function relativeImportClosure(entry: string): string[] {
  const visited = new Set<string>();
  const visit = (filePath: string) => {
    const absolutePath = resolve(filePath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);
    const source = readFileSync(absolutePath, "utf8");
    for (const builtin of forbiddenBuiltinSpecifiers(source)) visited.add(builtin);
    const specifiers = projectRelativeSpecifiers(source);
    for (const specifier of specifiers) {
      const raw = resolve(dirname(absolutePath), specifier);
      const candidates = [
        raw,
        raw.replace(/\.js$/u, ".ts"),
        extname(raw) ? "" : `${raw}.ts`,
        extname(raw) ? "" : resolve(raw, "index.ts"),
      ].filter(Boolean);
      const imported = candidates.find((candidate) => existsSync(candidate));
      if (imported) visit(imported);
    }
  };
  visit(entry);
  return [...visited].sort();
}

describe("intent compiler shadow report", () => {
  it("returns the exact stable bounded golden report without mutating inputs or exposing source text", () => {
    const legacyPlan = AssetPlan.parse(fixture.legacyPlan);
    const beforeLegacy = structuredClone(legacyPlan);
    const beforeCompilerInput = structuredClone(fixture.compilerInput);
    const report = buildIntentCompilerShadowReport({ legacyPlan, compilerInput: fixture.compilerInput });

    expect(report).toEqual({
      matched: false,
      counts: {
        legacy_tasks: 1,
        compiled_tasks: 5,
        legacy_dependencies: 0,
        compiled_dependencies: 3,
        differences: 6,
      },
      differences: [
        { code: "dependency_count_mismatch", path: "downstream.dependencies", count: 3 },
        { code: "dependency_type_counts_mismatch", path: "downstream.dependency_types", count: 1 },
        { code: "segment_coverage_mismatch", path: "downstream.segment_coverage", count: 1 },
        { code: "task_order_mismatch", path: "downstream.task_order", count: 1 },
        { code: "task_type_counts_mismatch", path: "downstream.task_type_counts", count: 4 },
        { code: "task_policy_counts_mismatch", path: "policy.task_policies", count: 1 },
      ],
    });
    expect(legacyPlan).toEqual(beforeLegacy);
    expect(fixture.compilerInput).toEqual(beforeCompilerInput);
    expect(report.differences.length).toBeLessThanOrEqual(50);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(fixture.compilerInput.draft.script_text);
    const imagePrompt = fixture.compilerInput.chunks[0]!.draft.segments[0]!.intents.find(
      (intent) => intent.asset_kind === "image_still",
    )?.image_prompt;
    expect(serialized).not.toContain(imagePrompt);
  });

  it("reports controlled source, policy, coverage, and dependency differences with stable codes", () => {
    const compiled = compileAssetPlanFromIntents(structuredClone(fixture.compilerInput)).plan;
    const compare = (mutate: (legacy: AssetPlan) => void) => {
      const legacy = structuredClone(compiled);
      mutate(legacy);
      return buildIntentCompilerShadowReport({ legacyPlan: legacy, compilerInput: fixture.compilerInput }).differences;
    };

    expect(compare((legacy) => { legacy.source_storyboard_record_id = "other_storyboard"; })).toEqual([
      { code: "source_storyboard_mismatch", path: "source.storyboard", count: 1 },
    ]);
    expect(compare((legacy) => { legacy.visual_budget = { mode: "legacy" }; })).toEqual([
      { code: "visual_budget_mismatch", path: "policy.visual_budget", count: 1 },
    ]);
    expect(compare((legacy) => {
      legacy.tasks.find((task) => task.source_segment_id !== null)!.source_segment_id = "other_segment";
    })).toEqual([
      { code: "segment_coverage_mismatch", path: "downstream.segment_coverage", count: 1 },
    ]);
    expect(compare((legacy) => { legacy.dependencies[0]!.dependency_type = "requires_output"; })).toEqual([
      { code: "dependency_type_counts_mismatch", path: "downstream.dependency_types", count: 1 },
    ]);
  });

  it("measures task type redistribution even when total task count is unchanged", () => {
    const compiled = compileAssetPlanFromIntents(structuredClone(fixture.compilerInput)).plan;
    const legacy = structuredClone(compiled);
    legacy.tasks.find((task) => task.task_type === "bgm_cue")!.task_type = "sfx_cue";
    const difference = buildIntentCompilerShadowReport({
      legacyPlan: legacy,
      compilerInput: fixture.compilerInput,
    }).differences.find((item) => item.code === "task_type_counts_mismatch");
    expect(difference).toEqual({
      code: "task_type_counts_mismatch",
      path: "downstream.task_type_counts",
      count: 2,
    });
  });

  it("extracts static, side-effect, and dynamic relative imports", () => {
    const source = [
      'import value from "./static.js";',
      'import "./side-effect.js";',
      'import "fs";',
      'const dynamic = import("./dynamic.js");',
      'const builtin = import("node:fs");',
    ].join("\n");
    expect(projectRelativeSpecifiers(source)).toEqual([
      "./static.js",
      "./side-effect.js",
      "./dynamic.js",
    ]);
    expect(forbiddenBuiltinSpecifiers(source)).toEqual(["fs", "node:fs"]);
  });

  it("rejects both bare and node-prefixed forbidden builtins", () => {
    expect(forbiddenClosureEntries([
      "fs",
      "node:fs",
      "fs/promises",
      "node:fs/promises",
      "node:util",
    ])).toEqual([
      "fs",
      "node:fs",
      "fs/promises",
      "node:fs/promises",
    ]);
  });

  it("keeps the recursive project import closure free of runtime side-effect modules", () => {
    const entry = resolve(dirname(new URL(import.meta.url).pathname.slice(1)),
      "../../../backend/src/modules/asset-planning/asset-plan-intent-shadow.ts");
    const closure = relativeImportClosure(entry);
    expect(closure.length).toBeGreaterThan(1);
    expect(forbiddenClosureEntries(closure)).toEqual([]);
    expect(closure.join("\n")).not.toMatch(
      /llm-gateway|repository|project-storage|runtime[\\/]trace|interaction-log|aggregate-writer|asset-planning-run\.service/iu,
    );
  });
});
