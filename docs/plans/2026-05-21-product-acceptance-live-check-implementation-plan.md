# 成品验收 Live Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一条显式成品验收 live-check，基于高质量 storyboard 样本执行真实 asset planning、真实 TTS、真实生图、字幕、本地 BGM、禁用 SFX，并用 Remotion 导出可人工观看的 MP4。

**Architecture:** 新增独立 runtime harness，不改业务语义链路。脚本读取固定上游样本，生成原始 `asset-plan.json`，再派生无 SFX、无 video_clip 的 `execution-asset-plan.json`，随后通过现有 backend API 执行 assets、compose、render，并输出验收摘要与人工 checklist。

**Tech Stack:** TypeScript、tsx、Vitest、Fastify inject 风格 backend app、DashScope assets providers、local subtitle provider、local BGM provider、Remotion renderer。

---

## 文件映射

- Create: `harness/scripts/runtime/product-acceptance-live-check.ts`
  - CLI 解析、source 读取、project seeding、asset planning、execution plan 派生、assets/compose/render 编排、验收摘要写入。
- Create: `tests/harness/product-acceptance-live-check.test.ts`
  - 纯函数与 mocked app 路径测试，不调用真实 DashScope，不跑真实 Remotion。
- Modify: `package.json`
  - 增加 `harness:product-acceptance-live-check`。
- Modify: `harness/README.md`
  - 记录显式 live-check 用法、真实环境变量、字幕检查点和禁用图生视频约束。

第一版不修改 `backend/src/modules/**`、`shared/src/**`、`renderer/src/**`。

---

### Task 1: CLI 与验收计划骨架

**Files:**
- Create: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Create: `tests/harness/product-acceptance-live-check.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试**

在 `tests/harness/product-acceptance-live-check.test.ts` 新增：

```ts
import { describe, expect, it } from "vitest";

import {
  buildProductAcceptanceLiveCheckPlan,
  parseProductAcceptanceLiveCheckCliArgs,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

describe("product acceptance live-check harness", () => {
  it("parses source, BGM and explicit real provider options", () => {
    expect(
      parseProductAcceptanceLiveCheckCliArgs([
        "--source-dir",
        "harness/scripts/runtime/output/source-a",
        "--output-dir",
        "harness/scripts/runtime/output/accept-a",
        "--bgm-id",
        "bgm_hist_ancient_china_solemn_001",
        "--dashscope-image-model",
        "wan2.6-t2i",
        "--dashscope-tts-model",
        "qwen3-tts-instruct-flash",
      ]),
    ).toMatchObject({
      sourceDir: "harness/scripts/runtime/output/source-a",
      outputDir: "harness/scripts/runtime/output/accept-a",
      bgmLibraryItemId: "bgm_hist_ancient_china_solemn_001",
      dashscope: {
        imageModel: "wan2.6-t2i",
        ttsModel: "qwen3-tts-instruct-flash",
      },
    });
  });

  it("builds an explicit live-check plan with subtitle requirements", () => {
    const plan = buildProductAcceptanceLiveCheckPlan({
      outputDir: "out",
      sourceDir: "source",
    });

    expect(plan.automated_gate).toBe(false);
    expect(plan.requires_real_env).toBe(true);
    expect(plan.provider_mode).toBe("dashscope");
    expect(plan.disabled_providers).toContain("dashscope_image_to_video");
    expect(plan.disabled_task_types).toContain("sfx_cue");
    expect(plan.required_artifacts).toContain("execution-asset-plan.json");
    expect(plan.required_checks).toContain("render subtitle_cue_count must be greater than 0");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts
```

Expected: FAIL，提示无法找到 `product-acceptance-live-check` 或导出函数。

- [ ] **Step 3: 实现最小 CLI 与 plan**

在 `harness/scripts/runtime/product-acceptance-live-check.ts` 新增：

```ts
import { resolve } from "node:path";

export interface ProductAcceptanceLiveCheckInput {
  sourceDir?: string;
  outputDir?: string;
  bgmLibraryItemId?: string;
  dashscope?: {
    apiKey?: string;
    baseUrl?: string;
    imageModel?: string;
    ttsModel?: string;
  };
  allowUpstreamGeneration?: boolean;
}

export interface ProductAcceptanceLiveCheckPlan {
  mode: "product_acceptance_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  source_dir: string | null;
  output_dir: string;
  disabled_providers: string[];
  disabled_task_types: string[];
  required_artifacts: string[];
  required_checks: string[];
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/product-acceptance-live-check",
);

export function buildProductAcceptanceLiveCheckPlan(
  input: ProductAcceptanceLiveCheckInput = {},
): ProductAcceptanceLiveCheckPlan {
  return {
    mode: "product_acceptance_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    source_dir: input.sourceDir ?? null,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    disabled_providers: ["dashscope_image_to_video"],
    disabled_task_types: ["video_clip", "sfx_cue"],
    required_artifacts: [
      "source-topic-package.json",
      "source-script-draft.json",
      "source-storyboard-plan.json",
      "asset-plan.json",
      "execution-asset-plan.json",
      "assets-response.json",
      "compose-response.json",
      "render-response.json",
      "acceptance-summary.json",
      "manual-review-checklist.md",
      "trace.md",
    ],
    required_checks: [
      "asset planning validation must pass",
      "manifest must contain dashscope_tts audio",
      "manifest must contain dashscope_image image",
      "manifest must contain local_subtitle subtitle_track",
      "render subtitle_cue_count must be greater than 0",
      "manifest must not contain sfx_audio",
      "provider list must not contain dashscope_image_to_video",
    ],
  };
}

export function parseProductAcceptanceLiveCheckCliArgs(
  argv: string[],
): ProductAcceptanceLiveCheckInput {
  const result: ProductAcceptanceLiveCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--source-dir" && next) {
      result.sourceDir = next;
      index += 1;
      continue;
    }
    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--bgm-id" && next) {
      result.bgmLibraryItemId = next;
      index += 1;
      continue;
    }
    if (current === "--dashscope-base-url" && next) {
      result.dashscope = { ...result.dashscope, baseUrl: next };
      index += 1;
      continue;
    }
    if (current === "--dashscope-image-model" && next) {
      result.dashscope = { ...result.dashscope, imageModel: next };
      index += 1;
      continue;
    }
    if (current === "--dashscope-tts-model" && next) {
      result.dashscope = { ...result.dashscope, ttsModel: next };
      index += 1;
      continue;
    }
    if (current === "--allow-upstream-generation") {
      result.allowUpstreamGeneration = true;
    }
  }

  return result;
}
```

在 `package.json` 增加：

```json
"harness:product-acceptance-live-check": "tsx harness/scripts/runtime/product-acceptance-live-check.ts"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts package.json
git commit -m "新增成品验收入口骨架"
```

---

### Task 2: Source 样本读取与项目种子

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试，使用临时目录写入三个 source 文件：

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadProductAcceptanceSource,
  seedProductAcceptanceProject,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("loads source topic, script and storyboard and seeds active project records", async () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "svf2-acceptance-source-"));
  writeFileSync(
    join(sourceDir, "source-topic-package.json"),
    JSON.stringify(makeTopicPackageFixture()),
    "utf8",
  );
  writeFileSync(
    join(sourceDir, "source-script-draft.json"),
    JSON.stringify(makeScriptDraftFixture()),
    "utf8",
  );
  writeFileSync(
    join(sourceDir, "source-storyboard-plan.json"),
    JSON.stringify(makeStoryboardPlanFixture()),
    "utf8",
  );

  const source = loadProductAcceptanceSource(sourceDir);
  const seeded = await seedProductAcceptanceProject({
    source,
    outputDir: mkdtempSync(join(tmpdir(), "svf2-acceptance-output-")),
  });

  expect(source.topicPackage.title).toBe("晏子使楚");
  expect(seeded.project.activeTopicPackageId).toBeTruthy();
  expect(seeded.project.activeScriptRecordId).toBeTruthy();
  expect(seeded.project.activeStoryboardRecordId).toBeTruthy();
  expect(seeded.app.db.storyboardRecords.size).toBe(1);
});
```

同文件加入 fixture helper：

```ts
function makeTopicPackageFixture() {
  return {
    topic_id: "topic_yanzi_acceptance",
    title: "晏子使楚",
    selected_angle: "楚王设局羞辱齐人，晏子用一句话反压全场。",
    family_label: "春秋外交",
    scope_label: "单事件",
    core_conflict: "楚王想借囚犯羞辱齐国，晏子必须当场反击。",
    stakes: "如果回答失手，齐国使者会在楚廷失去体面。",
    strong_scene: "楚王指着囚犯发问，满殿等着晏子出丑。",
    packaging_seed: "一场外交羞辱被一句话翻盘。",
    must_include_beats: [
      "楚王设局",
      "晏子观察囚犯",
      "橘生淮南则为橘的反击",
    ],
    forbidden_expansions: ["不要扩写到未确认的后续战争"],
    risk_hints: ["避免现代政治词汇"],
    source_anchor_refs: ["《晏子春秋》相关故事"],
    canonical_quotes: ["橘生淮南则为橘，生于淮北则为枳"],
    canonical_quote_intents: [
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        intent: "用环境反讽楚国治理",
      },
    ],
    ambiguity_notes: ["不同版本细节略有差异"],
    duration_band: "medium",
    narrative_tension_map: {
      hook_claim: "楚王当众挖坑，晏子不能退。",
      pressure_escalation: "囚犯被带上殿，羞辱从暗处推到明处。",
      mid_reveal: "晏子不急着辩解，先顺着楚王的问题走。",
      peak_payoff: "一句橘枳之别，把羞辱还给楚国。",
      ending_residue: "真正被审问的不是齐人，而是楚国的水土。",
    },
  };
}

function makeScriptDraftFixture() {
  return {
    script_text:
      "楚王把一个囚犯押到殿前，故意问晏子：齐国人都善于偷盗吗？满殿的人都等着看这个矮小的使者出丑。晏子没有急着争辩，只是看了看那个囚犯，又看向楚王。他说，橘生淮南则为橘，生于淮北则为枳。不是种子变坏了，是水土变了。殿上忽然安静下来。楚王本想羞辱齐国，最后却把楚国自己摆到了众人面前。",
    estimated_duration_sec: 34,
    beat_trace: [
      {
        beat: "楚王设局",
        excerpt: "楚王把一个囚犯押到殿前",
        confidence: 0.95,
      },
      {
        beat: "晏子反击",
        excerpt: "橘生淮南则为橘，生于淮北则为枳",
        confidence: 0.95,
      },
    ],
    quote_trace: [
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        usage_type: "exact",
        excerpt: "他说，橘生淮南则为橘，生于淮北则为枳。",
      },
    ],
    opening_span: "楚王把一个囚犯押到殿前，故意问晏子：齐国人都善于偷盗吗？",
    ending_span: "楚王本想羞辱齐国，最后却把楚国自己摆到了众人面前。",
  };
}

function makeStoryboardPlanFixture() {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "script_yanzi_acceptance",
    source_topic_package_id: "topic_yanzi_acceptance",
    estimated_total_duration_sec: 34,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "楚王把一个囚犯押到殿前，故意问晏子。",
        start_hint_sec: 0,
        end_hint_sec: 12,
        narrative_role: "opening",
        visual_intent: "楚廷公开羞辱的压力",
        scene_description: "古代楚国宫殿内，囚犯被带到殿前，群臣侧目。",
        visual_elements: ["楚王", "晏子", "囚犯", "宫殿"],
        framing_hint: "wide",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["楚王设局"],
        linked_quotes: [],
        risk_notes: ["避免现代服饰和文字水印"],
      },
    ],
    global_visual_notes: ["整体保持中国古代历史正剧质感"],
  };
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "loads source"
```

Expected: FAIL，提示函数未导出。

- [ ] **Step 3: 实现 source loader**

在 harness 中使用 shared schema parse：

```ts
import { existsSync, readFileSync } from "node:fs";
import {
  ScriptDraftPackage,
  StoryboardPlan,
  TopicPackage,
  type ScriptDraftPackage as ScriptDraftPackageType,
  type StoryboardPlan as StoryboardPlanType,
  type TopicPackage as TopicPackageType,
} from "../../../shared/src/index.js";

export interface ProductAcceptanceSource {
  sourceDir: string;
  topicPackage: TopicPackageType;
  scriptDraft: ScriptDraftPackageType;
  storyboardPlan: StoryboardPlanType;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function loadProductAcceptanceSource(sourceDir: string): ProductAcceptanceSource {
  const sourceTopicPath = resolve(sourceDir, "source-topic-package.json");
  const topicPath = existsSync(sourceTopicPath)
    ? sourceTopicPath
    : resolve(sourceDir, "topic-package.json");
  const sourceScriptPath = resolve(sourceDir, "source-script-draft.json");
  const scriptPath = existsSync(sourceScriptPath)
    ? sourceScriptPath
    : resolve(sourceDir, "script-draft.json");
  const sourceStoryboardPath = resolve(sourceDir, "source-storyboard-plan.json");
  const storyboardPath = existsSync(sourceStoryboardPath)
    ? sourceStoryboardPath
    : resolve(sourceDir, "storyboard-plan.json");

  return {
    sourceDir,
    topicPackage: TopicPackage.parse(readJson(topicPath)),
    scriptDraft: ScriptDraftPackage.parse(readJson(scriptPath)),
    storyboardPlan: StoryboardPlan.parse(readJson(storyboardPath)),
  };
}
```

- [ ] **Step 4: 实现 project seed**

复用 repository：

```ts
import { buildApp } from "../../../backend/src/app";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository";
import type { AppInstance } from "../../../backend/src/app";
import type { ProjectRecord } from "../../../backend/src/db/client";
import type { RenderAdapter } from "../../../backend/src/modules/render/render-adapter";

export interface SeededProductAcceptanceProject {
  app: AppInstance;
  project: ProjectRecord;
}

export async function seedProductAcceptanceProject(input: {
  source: ProductAcceptanceSource;
  outputDir: string;
  renderAdapter?: RenderAdapter;
}): Promise<SeededProductAcceptanceProject> {
  const app = buildApp(
    input.renderAdapter ? { renderAdapter: input.renderAdapter } : undefined,
  );
  const projectBody = await injectOrThrow({
    app,
    method: "POST",
    url: "/api/projects",
    payload: { name: `Product Acceptance - ${input.source.topicPackage.title}` },
  });
  const project = app.db.projects.get(projectBody.project_id as string);
  if (!project) throw new Error("acceptance_project_missing_after_create");
  project.storageRootDir = resolve(input.outputDir, "project-storage");

  const topicRecord = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: input.source.topicPackage.title,
    selectedAngle: input.source.topicPackage.selected_angle,
    familyLabel: input.source.topicPackage.family_label,
    scopeLabel: input.source.topicPackage.scope_label,
    coreConflict: input.source.topicPackage.core_conflict,
    strongScene: input.source.topicPackage.strong_scene,
    stakes: input.source.topicPackage.stakes,
    packagingSeed: input.source.topicPackage.packaging_seed,
    canonicalQuotesJson: input.source.topicPackage.canonical_quotes,
    canonicalQuoteIntentsJson: input.source.topicPackage.canonical_quote_intents,
    durationBandJson: { label: input.source.topicPackage.duration_band },
    narrativeTensionMapJson: input.source.topicPackage.narrative_tension_map,
    mustIncludeBeatsJson: input.source.topicPackage.must_include_beats,
    forbiddenExpansionsJson: input.source.topicPackage.forbidden_expansions,
    riskHintsJson: input.source.topicPackage.risk_hints,
    sourceAnchorRefsJson: input.source.topicPackage.source_anchor_refs,
    ambiguityNotesJson: input.source.topicPackage.ambiguity_notes,
  });

  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicRecord.id,
    scriptText: input.source.scriptDraft.script_text,
    openingSpan: input.source.scriptDraft.opening_span,
    endingSpan: input.source.scriptDraft.ending_span,
    estimatedDurationSec: input.source.scriptDraft.estimated_duration_sec,
    beatTraceJson: input.source.scriptDraft.beat_trace,
    quoteTraceJson: input.source.scriptDraft.quote_trace,
    reviewStatus: "accepted_for_product_acceptance",
    validationResultJson: null,
    semanticReviewResultJson: null,
    executionStateJson: null,
  });

  const storyboardRecord = await saveStoryboardRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicRecord.id,
    scriptRecordId: scriptRecord.id,
    planJson: input.source.storyboardPlan,
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
  });

  project.activeTopicPackageId = topicRecord.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";

  return { app, project };
}

async function injectOrThrow(input: {
  app: AppInstance;
  method: string;
  url: string;
  payload?: unknown;
}): Promise<Record<string, unknown>> {
  const response = await input.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
  });

  const body = response.json() as Record<string, unknown>;
  if (response.statusCode >= 400) {
    throw new Error(
      `request_failed ${input.method} ${input.url}: ${response.statusCode} ${JSON.stringify(body)}`,
    );
  }

  return body;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "loads source"
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "支持成品验收读取上游样本"
```

---

### Task 3: 生成 asset plan 并派生 execution plan

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

新增纯函数测试：

```ts
import {
  sanitizeAssetPlanForProductAcceptance,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("removes SFX and video clip tasks while preserving subtitle tasks", () => {
  const sanitized = sanitizeAssetPlanForProductAcceptance(
    makeAssetPlanFixture({
      tasks: [
        makeAssetTask("tts_001", "tts_audio", null),
        makeAssetTask("sub_001", "subtitle_track", null),
        makeAssetTask("img_001", "image_still", "sb_001"),
        makeAssetTask("motion_001", "render_motion_cue", "sb_001"),
        makeAssetTask("video_001", "video_clip", "sb_001"),
        makeAssetTask("sfx_001", "sfx_cue", "sb_001"),
        makeAssetTask("bgm_001", "bgm_cue", null),
      ],
      dependencies: [
        {
          dependency_id: "dep_video_img",
          task_id: "video_001",
          depends_on_task_id: "img_001",
          dependency_type: "requires_output",
        },
        {
          dependency_id: "dep_sfx_video",
          task_id: "sfx_001",
          depends_on_task_id: "video_001",
          dependency_type: "requires_timing",
        },
      ],
    }),
  );

  expect(sanitized.tasks.map((task) => task.task_type)).toEqual([
    "tts_audio",
    "subtitle_track",
    "image_still",
    "render_motion_cue",
    "bgm_cue",
  ]);
  expect(sanitized.dependencies).toEqual([]);
  expect(sanitized.cost_summary.by_type).toMatchObject({
    tts_audio: 1,
    subtitle_track: 1,
    image_still: 1,
    render_motion_cue: 1,
    bgm_cue: 1,
  });
});

it("fails when a segment has no static image anchor after sanitizing", () => {
  expect(() =>
    sanitizeAssetPlanForProductAcceptance(
      makeAssetPlanFixture({
        tasks: [
          makeAssetTask("tts_001", "tts_audio", null),
          makeAssetTask("sub_001", "subtitle_track", null),
          makeAssetTask("video_001", "video_clip", "sb_001"),
        ],
      }),
    ),
  ).toThrow("acceptance_visual_anchor_missing: sb_001");
});
```

同文件加入 AssetPlan helper：

```ts
import type { AssetPlan, AssetTask } from "../../shared/src/index";

function makeAssetTask(
  taskId: string,
  taskType: AssetTask["task_type"],
  segmentId: string | null,
): AssetTask {
  return {
    task_id: taskId,
    order: 0,
    task_type: taskType,
    source_segment_id: segmentId,
    source_excerpt: "楚廷对峙",
    production_intent: "用于成品验收",
    recommended_mode: "auto",
    provider_hint:
      taskType === "subtitle_track"
        ? "local_subtitle"
        : taskType === "bgm_cue"
          ? "local_bgm"
          : taskType === "sfx_cue"
            ? "local_sfx"
            : taskType === "tts_audio"
              ? "dashscope_tts"
              : taskType === "render_motion_cue"
                ? "local_motion"
                : "dashscope_image",
    prompt_draft:
      taskType === "image_still" || taskType === "video_clip"
        ? "ancient Chinese court confrontation, cinematic vertical frame"
        : null,
    parameters:
      taskType === "bgm_cue"
        ? { required_tags: ["background", "historical"], mood_tags: ["solemn"] }
        : {},
    manual_upload_policy: {
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    },
    risk_notes:
      taskType === "image_still" || taskType === "video_clip" || taskType === "render_motion_cue"
        ? ["避免现代服饰和文字水印"]
        : [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function makeAssetPlanFixture(input: {
  tasks: AssetTask[];
  dependencies?: AssetPlan["dependencies"];
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_acceptance",
    source_script_record_id: "script_acceptance",
    source_topic_package_id: "topic_acceptance",
    art_bible: {
      era_style: "中国春秋时期",
      visual_tone: "历史正剧，克制紧张",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: ["modern building", "watermark", "text"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_system_ethan",
      estimated_total_duration_sec: 34,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: "楚王把一个囚犯押到殿前。",
          estimated_duration_sec: 12,
        },
      ],
    },
    tasks: input.tasks.map((task, index) => ({ ...task, order: index })),
    dependencies: input.dependencies ?? [],
    cost_summary: {
      total_tasks: input.tasks.length,
      by_type: {},
      by_cost_tier: { low: input.tasks.length },
      estimated_provider_calls: input.tasks.length,
      notes: [],
    },
    global_production_notes: [],
  };
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "sanit"
```

Expected: FAIL，提示函数未导出。

- [ ] **Step 3: 实现 sanitizer**

在 harness 中新增：

```ts
import { AssetPlan, type AssetPlan as AssetPlanType } from "../../../shared/src/index.js";

const DISABLED_ACCEPTANCE_TASK_TYPES = new Set(["video_clip", "sfx_cue"]);

export function sanitizeAssetPlanForProductAcceptance(
  plan: AssetPlanType,
): AssetPlanType {
  const removedTaskIds = new Set(
    plan.tasks
      .filter((task) => DISABLED_ACCEPTANCE_TASK_TYPES.has(task.task_type))
      .map((task) => task.task_id),
  );
  const tasks = plan.tasks.filter((task) => !removedTaskIds.has(task.task_id));
  const dependencies = plan.dependencies.filter(
    (dependency) =>
      !removedTaskIds.has(dependency.task_id) &&
      !removedTaskIds.has(dependency.depends_on_task_id),
  );
  const segmentIds = Array.from(
    new Set(
      plan.tasks
        .map((task) => task.source_segment_id)
        .filter((segmentId): segmentId is string => Boolean(segmentId)),
    ),
  );

  for (const segmentId of segmentIds) {
    const hasImageAnchor = tasks.some(
      (task) =>
        task.source_segment_id === segmentId &&
        task.task_type === "image_still",
    );
    if (!hasImageAnchor) {
      throw new Error(`acceptance_visual_anchor_missing: ${segmentId}`);
    }
  }

  const byType: Record<string, number> = {};
  const byCostTier: Record<string, number> = {};
  for (const task of tasks) {
    byType[task.task_type] = (byType[task.task_type] ?? 0) + 1;
    byCostTier[task.cost_tier] = (byCostTier[task.cost_tier] ?? 0) + 1;
  }

  return AssetPlan.parse({
    ...plan,
    tasks,
    dependencies,
    cost_summary: {
      total_tasks: tasks.length,
      by_type: byType,
      by_cost_tier: byCostTier,
      estimated_provider_calls: tasks.filter((task) =>
        ["tts_audio", "image_still", "bgm_cue", "subtitle_track"].includes(task.task_type),
      ).length,
      notes: [
        ...plan.cost_summary.notes,
        "product_acceptance_execution_plan_removed_video_clip_and_sfx",
      ],
    },
  });
}
```

- [ ] **Step 4: 接入 asset planning 生成**

新增 `runAcceptanceAssetPlanning()`。默认通过真实项目 API 调用 `POST /api/projects/:projectId/asset-plan/generate`；测试中允许注入 `generateAssetPlan`，避免真实 LLM。

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";

function writeJson(outputDir: string, filename: string, value: unknown) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

export async function runAcceptanceAssetPlanning(input: {
  app: AppInstance;
  project: ProjectRecord;
  outputDir: string;
  generateAssetPlan?: () => Promise<Record<string, unknown>>;
}) {
  const rawBody = input.generateAssetPlan
    ? await input.generateAssetPlan()
    : await injectOrThrow({
        app: input.app,
        method: "POST",
        url: `/api/projects/${input.project.id}/asset-plan/generate`,
        payload: {},
      });

  const originalPlan = AssetPlan.parse(
    rawBody.asset_plan ?? rawBody.plan ?? rawBody.assetPlan,
  );
  const validation = rawBody.local_validation ?? rawBody.validation ?? {
    stage: "asset_planning_local_validation",
    decision: "pass",
    errors: [],
    warnings: [],
    metrics: {},
  };
  writeJson(input.outputDir, "asset-plan.json", originalPlan);
  writeJson(input.outputDir, "asset-planning-validation-result.json", validation);

  const executionPlan = sanitizeAssetPlanForProductAcceptance(originalPlan);
  writeJson(input.outputDir, "execution-asset-plan.json", executionPlan);

  const activeAssetPlanRecordId = input.project.activeAssetPlanRecordId;
  const activeAssetPlanRecord = activeAssetPlanRecordId
    ? input.app.db.assetPlanRecords.get(activeAssetPlanRecordId)
    : null;
  if (!activeAssetPlanRecord) {
    throw new Error("product_acceptance_asset_plan_record_missing_after_generation");
  }

  const executionRecord = await saveAssetPlanRecord(input.app.db, {
    id: `asset_plan_product_acceptance_execution_${input.app.db.generateId()}`,
    projectId: input.project.id,
    topicPackageId: activeAssetPlanRecord.topicPackageId,
    scriptRecordId: activeAssetPlanRecord.scriptRecordId,
    storyboardRecordId: activeAssetPlanRecord.storyboardRecordId,
    planJson: executionPlan,
    validationResultJson: activeAssetPlanRecord.validationResultJson,
    executionStateJson: {
      source_asset_plan_record_id: activeAssetPlanRecord.id,
      sanitized_for_product_acceptance: true,
      disabled_task_types: ["video_clip", "sfx_cue"],
    },
    graphTraceSummaryJson: activeAssetPlanRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: activeAssetPlanRecord.runtimeDiagnosticsJson,
  });

  input.project.activeAssetPlanRecordId = executionRecord.id;
  input.project.status = "asset_plan_ready";

  return {
    originalPlan,
    executionPlan,
    originalAssetPlanRecordId: activeAssetPlanRecord.id,
    executionAssetPlanRecordId: executionRecord.id,
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "sanit"
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "派生成品验收执行资产计划"
```

---

### Task 4: 媒体库 seed 与真实 assets payload

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

测试 env 读取和 assets payload：

```ts
import {
  buildProductAcceptanceAssetsPayload,
  resolveProductAcceptanceEnv,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("builds DashScope assets payload with real TTS, real image and WAV TTS format", () => {
  const payload = buildProductAcceptanceAssetsPayload({
    env: {
      ALIYUN_DASHSCOPE_API_KEY: "key",
      ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.test",
      ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: "wan2.6-t2i",
      ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
    },
  });

  expect(payload).toMatchObject({
    voice_profile_id: "voice_system_ethan",
    execution_mode: "auto_available",
    provider_mode: "dashscope",
    dashscope: {
      api_key: "key",
      base_url: "https://dashscope.test",
      image_model: "wan2.6-t2i",
      tts_model: "qwen3-tts-instruct-flash",
      tts_format: "wav",
    },
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "DashScope assets payload"
```

Expected: FAIL。

- [ ] **Step 3: 实现 env 和 payload**

实现：

```ts
export interface ProductAcceptanceEnv {
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
}

export function buildProductAcceptanceAssetsPayload(input: {
  env: ProductAcceptanceEnv;
  dashscope?: ProductAcceptanceLiveCheckInput["dashscope"];
}) {
  const apiKey = input.dashscope?.apiKey ?? input.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error("product_acceptance_dashscope_api_key_missing");
  }

  return {
    voice_profile_id: "voice_system_ethan",
    execution_mode: "auto_available",
    provider_mode: "dashscope",
    dashscope: {
      api_key: apiKey,
      base_url:
        input.dashscope?.baseUrl ??
        input.env.ALIYUN_DASHSCOPE_BASE_URL ??
        "https://dashscope.aliyuncs.com",
      image_model:
        input.dashscope?.imageModel ??
        input.env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL ??
        "wan2.6-t2i",
      tts_model:
        input.dashscope?.ttsModel ??
        input.env.ALIYUN_DASHSCOPE_TTS_MODEL ??
        "qwen3-tts-instruct-flash",
      tts_format: "wav",
    },
  };
}
```

媒体库 seed 与设计保持一致：优先读取 `storage/media-library/ai-bgm-prompt-candidates.json` 中已通过的 BGM；若该文件不存在或无可用条目，再写入 `DEFAULT_AUDIO_LIBRARY_ITEMS` 作为兜底。执行计划里已经没有 `sfx_cue`，所以默认 SFX seed 不会被消费。

```ts
import { existsSync } from "node:fs";
import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository";

export async function seedAcceptanceMediaLibrary(
  app: AppInstance,
  input: { bgmLibraryItemId?: string } = {},
) {
  const catalogPath = resolve(
    process.cwd(),
    "storage/media-library/ai-bgm-prompt-candidates.json",
  );
  const loadedItems = existsSync(catalogPath)
    ? await loadLightweightBgmCatalogItems(catalogPath)
    : [];
  for (const entry of loadedItems) {
    await saveMediaLibraryItem(app.db, entry.item);
  }
  for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
    await saveMediaLibraryItem(app.db, item);
  }

  if (input.bgmLibraryItemId) {
    const found = app.db.mediaLibraryItems.get(input.bgmLibraryItemId);
    if (!found) {
      throw new Error(`product_acceptance_bgm_not_found: ${input.bgmLibraryItemId}`);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "DashScope assets payload"
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "配置成品验收真实素材生成参数"
```

---

### Task 5: Assets / Compose / Render 编排与字幕断言

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

使用 fake app dependency 测试编排顺序和字幕检查：

```ts
import {
  assertProductAcceptanceRenderReadiness,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("requires subtitle artifacts and rendered subtitle cues", () => {
  expect(() =>
    assertProductAcceptanceRenderReadiness({
      assetsBody: {
        manifest: {
          artifacts: [
            {
              artifact_type: "subtitle_track",
              metadata: {
                caption_count: 3,
                source_tts_chunk_artifact_ids: ["artifact_tts_chunk_1"],
                subtitle_style: { font_size_px: 48 },
              },
            },
          ],
        },
      },
      renderBody: {
        runtime_diagnostics: {
          subtitle_cue_count: 3,
          audio_clip_count: 2,
          visual_clip_count: 1,
        },
        output_artifact: {
          file_uri: "out.mp4",
          mime_type: "video/mp4",
        },
      },
    }),
  ).not.toThrow();
});

it("fails when subtitles are missing from render diagnostics", () => {
  expect(() =>
    assertProductAcceptanceRenderReadiness({
      assetsBody: {
        manifest: {
          artifacts: [
            {
              artifact_type: "subtitle_track",
              metadata: {
                caption_count: 3,
                source_tts_chunk_artifact_ids: ["artifact_tts_chunk_1"],
                subtitle_style: { font_size_px: 48 },
              },
            },
          ],
        },
      },
      renderBody: {
        runtime_diagnostics: {
          subtitle_cue_count: 0,
          audio_clip_count: 2,
          visual_clip_count: 1,
        },
        output_artifact: {
          file_uri: "out.mp4",
          mime_type: "video/mp4",
        },
      },
    }),
  ).toThrow("product_acceptance_subtitles_not_rendered");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "subtitle"
```

Expected: FAIL。

- [ ] **Step 3: 实现 readiness assertion**

实现：

```ts
export function assertProductAcceptanceRenderReadiness(input: {
  assetsBody: Record<string, unknown>;
  renderBody: Record<string, unknown>;
}): void {
  const manifest = input.assetsBody.manifest as
    | { artifacts?: Array<{ artifact_type?: string; metadata?: Record<string, unknown> }> }
    | undefined;
  const artifacts = manifest?.artifacts ?? [];
  const subtitleArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "subtitle_track",
  );
  if (!subtitleArtifact) {
    throw new Error("product_acceptance_subtitle_artifact_missing");
  }
  if (Number(subtitleArtifact.metadata?.caption_count ?? 0) <= 0) {
    throw new Error("product_acceptance_subtitle_caption_count_empty");
  }
  if (!subtitleArtifact.metadata?.subtitle_style) {
    throw new Error("product_acceptance_subtitle_style_missing");
  }

  const diagnostics = input.renderBody.runtime_diagnostics as
    | Record<string, unknown>
    | undefined;
  if (Number(diagnostics?.subtitle_cue_count ?? 0) <= 0) {
    throw new Error("product_acceptance_subtitles_not_rendered");
  }
  if (Number(diagnostics?.audio_clip_count ?? 0) <= 0) {
    throw new Error("product_acceptance_audio_not_rendered");
  }
  if (Number(diagnostics?.visual_clip_count ?? 0) <= 0) {
    throw new Error("product_acceptance_visual_not_rendered");
  }
}
```

- [ ] **Step 4: 实现 API 编排**

`runProductAcceptanceLiveCheck()` 使用完整项目 API 路径，不向 asset planning / compose / render 传自定义 payload：

```ts
import { createLocalRemotionRenderAdapter } from "../../../backend/src/modules/render/local-remotion-render-adapter";

export interface ProductAcceptanceLiveCheckResult {
  outputDir: string;
  summary: Awaited<ReturnType<typeof buildProductAcceptanceSummary>>;
}

export async function runProductAcceptanceLiveCheck(
  input: ProductAcceptanceLiveCheckInput = {},
): Promise<ProductAcceptanceLiveCheckResult> {
  const plan = buildProductAcceptanceLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const sourceDir = await resolveProductAcceptanceSourceDir(input);
  const source = loadProductAcceptanceSource(sourceDir);
  writeJson(plan.output_dir, "source-topic-package.json", source.topicPackage);
  writeJson(plan.output_dir, "source-script-draft.json", source.scriptDraft);
  writeJson(plan.output_dir, "source-storyboard-plan.json", source.storyboardPlan);

  const seeded = await seedProductAcceptanceProject({
    source,
    outputDir: plan.output_dir,
    renderAdapter: createLocalRemotionRenderAdapter(),
  });
  await seedAcceptanceMediaLibrary(seeded.app, {
    bgmLibraryItemId: input.bgmLibraryItemId,
  });

  const planning = await runAcceptanceAssetPlanning({
    app: seeded.app,
    project: seeded.project,
    outputDir: plan.output_dir,
  });

  const env = resolveProductAcceptanceEnv();
  const assetsBody = await injectOrThrow({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/assets/generate`,
    payload: buildProductAcceptanceAssetsPayload({
      env,
      dashscope: input.dashscope,
    }),
  });
  writeJson(plan.output_dir, "assets-response.json", assetsBody);

  const assetsSnapshot = await injectOrThrow({
    app: seeded.app,
    method: "GET",
    url: `/api/projects/${seeded.project.id}`,
  });
  writeJson(plan.output_dir, "assets-snapshot.json", assetsSnapshot);

  const composeBody = await injectOrThrow({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/compose/generate`,
    payload: {},
  });
  writeJson(plan.output_dir, "compose-response.json", composeBody);

  const renderBody = await injectOrThrow({
    app: seeded.app,
    method: "POST",
    url: `/api/projects/${seeded.project.id}/render/generate`,
    payload: {},
  });
  writeJson(plan.output_dir, "render-response.json", renderBody);

  assertProductAcceptanceRenderReadiness({ assetsBody, renderBody });

  const summary = await buildProductAcceptanceSummary({
    sourceTitle: source.topicPackage.title,
    outputDir: plan.output_dir,
    assetsBody,
    composeBody,
    renderBody,
    projectStorageRootDir: seeded.project.storageRootDir,
  });
  writeJson(plan.output_dir, "acceptance-summary.json", summary);
  writeManualReviewChecklist(plan.output_dir);
  writeTrace(plan.output_dir, {
    sourceDir,
    projectId: seeded.project.id,
    originalAssetPlanRecordId: planning.originalAssetPlanRecordId,
    executionAssetPlanRecordId: planning.executionAssetPlanRecordId,
    outputMp4Path: summary.output_mp4_path,
  });

  return { outputDir: plan.output_dir, summary };
}
```

- [ ] **Step 5: 运行 focused 测试**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "串联成品验收渲染链路"
```

---

### Task 6: 验收摘要、音频基础诊断与人工 checklist

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

新增 summary 测试：

```ts
import {
  buildProductAcceptanceSummary,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("summarizes providers, subtitles, disabled SFX and image-to-video absence", async () => {
  const summary = await buildProductAcceptanceSummary({
    sourceTitle: "晏子使楚",
    outputDir: "out",
    assetsBody: {
      manifest: {
        executions: [
          { provider_id: "dashscope_tts" },
          { provider_id: "dashscope_image" },
          { provider_id: "local_subtitle" },
          { provider_id: "local_bgm" },
        ],
        artifacts: [
          { artifact_type: "tts_chunk_audio", metadata: { provider_name: "dashscope_tts" } },
          { artifact_type: "image", metadata: { provider_name: "dashscope_image" } },
          { artifact_type: "subtitle_track", metadata: { caption_count: 4, subtitle_style: { font_size_px: 48 } } },
          { artifact_type: "bgm_audio", metadata: { library_item_id: "bgm_1" } },
        ],
        audio_summary: { sfx_artifact_ids: [] },
      },
    },
    composeBody: {
      timeline: {
        tracks: [{ track_type: "sfx", clips: [] }],
      },
    },
    renderBody: {
      output_artifact: { file_uri: "out/output.mp4" },
      runtime_diagnostics: { subtitle_cue_count: 4, audio_clip_count: 2, visual_clip_count: 1 },
    },
  });

  expect(summary.status).toBe("sample-ready");
  expect(summary.disabled_sfx_confirmed).toBe(true);
  expect(summary.image_to_video_not_called_confirmed).toBe(true);
  expect(summary.subtitle_diagnostics.cue_count).toBe(4);
  expect(summary.audio_diagnostics.tts?.rms).toBeNull();
  expect(summary.audio_diagnostics.bgm?.rms).toBeNull();
  expect(summary.provider_names).toEqual([
    "dashscope_tts",
    "dashscope_image",
    "local_subtitle",
    "local_bgm",
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "summarizes"
```

Expected: FAIL。

- [ ] **Step 3: 实现 summary builder**

实现 provider/type 统计、SFX 禁用确认、图生视频未调用确认、字幕 cue 统计和 WAV RMS 诊断。provider 名称必须同时读取 artifact metadata 与 `manifest.executions[].provider_id`，因为本地 subtitle/BGM artifact 当前不写 `metadata.provider_name`：

```ts
import { existsSync, readFileSync } from "node:fs";

export async function buildProductAcceptanceSummary(input: {
  sourceTitle: string;
  outputDir: string;
  assetsBody: Record<string, unknown>;
  composeBody: Record<string, unknown>;
  renderBody: Record<string, unknown>;
  projectStorageRootDir?: string;
}) {
  const manifest = input.assetsBody.manifest as
    | {
        artifacts?: Array<{
          artifact_type?: string;
          file_uri?: string;
          metadata?: Record<string, unknown>;
        }>;
        executions?: Array<{ provider_id?: string | null }>;
        audio_summary?: { sfx_artifact_ids?: string[] };
      }
    | undefined;
  const artifacts = manifest?.artifacts ?? [];
  const providerNames = readProviderNames({ manifest });
  const subtitleArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "subtitle_track",
  );
  const ttsArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "tts_merged_audio",
  );
  const bgmArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "bgm_audio",
  );
  const renderDiagnostics =
    (input.renderBody.runtime_diagnostics as Record<string, unknown> | undefined) ?? {};

  return {
    status: "sample-ready",
    source_title: input.sourceTitle,
    output_dir: input.outputDir,
    output_mp4_path:
      (input.renderBody.output_artifact as { file_uri?: string } | undefined)
        ?.file_uri ?? null,
    provider_names: providerNames,
    artifact_type_counts: countBy(
      artifacts.map((artifact) => artifact.artifact_type).filter(Boolean) as string[],
    ),
    disabled_sfx_confirmed:
      !artifacts.some((artifact) => artifact.artifact_type === "sfx_audio") &&
      (manifest?.audio_summary?.sfx_artifact_ids ?? []).length === 0,
    image_to_video_not_called_confirmed:
      !providerNames.includes("dashscope_image_to_video") &&
      !artifacts.some((artifact) => artifact.artifact_type === "video"),
    subtitle_diagnostics: {
      caption_count: Number(subtitleArtifact?.metadata?.caption_count ?? 0),
      cue_count: Number(renderDiagnostics.subtitle_cue_count ?? 0),
      has_style: Boolean(subtitleArtifact?.metadata?.subtitle_style),
    },
    audio_diagnostics: {
      tts: readWavRmsDiagnostics(ttsArtifact?.file_uri),
      bgm: readWavRmsDiagnostics(bgmArtifact?.file_uri),
    },
    render_diagnostics: renderDiagnostics,
  };
}

function readProviderNames(input: {
  manifest:
    | {
        artifacts?: Array<{ metadata?: Record<string, unknown> }>;
        executions?: Array<{ provider_id?: string | null }>;
      }
    | undefined;
}): string[] {
  return Array.from(
    new Set([
      ...((input.manifest?.artifacts ?? [])
        .map((artifact) => artifact.metadata?.provider_name)
        .filter((value): value is string => typeof value === "string")),
      ...((input.manifest?.executions ?? [])
        .map((execution) => execution.provider_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)),
    ]),
  );
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] ?? 0) + 1;
    return acc;
  }, {});
}

function readWavRmsDiagnostics(fileUri: string | undefined): {
  file_uri: string;
  bytes: number;
  rms: number;
  max: number;
} | { file_uri: null; bytes: 0; rms: null; max: null } {
  if (!fileUri || !existsSync(fileUri)) {
    return { file_uri: null, bytes: 0, rms: null, max: null };
  }

  const buffer = readFileSync(fileUri);
  if (buffer.length <= 44) {
    return { file_uri: fileUri, bytes: buffer.length, rms: 0, max: 0 };
  }

  let sumSquares = 0;
  let max = 0;
  let samples = 0;
  for (let offset = 44; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const abs = Math.abs(sample);
    max = Math.max(max, abs);
    sumSquares += sample * sample;
    samples += 1;
  }

  return {
    file_uri: fileUri,
    bytes: buffer.length,
    rms: samples > 0 ? Math.sqrt(sumSquares / samples) : 0,
    max,
  };
}
```

新增 `manual-review-checklist.md` 内容：

```md
# 成品验收人工检查

- [ ] 口播能听清，BGM 没有压过口播。
- [ ] 字幕出现，位置不遮挡主体，节奏大致跟随口播。
- [ ] 生图符合中国古代历史题材，没有明显现代物、文字水印或严重脸部崩坏。
- [ ] 画面运动没有明显黑屏、闪烁或卡死。
- [ ] BGM 情绪适配题材，不像现代电子舞曲或无关氛围音。
- [ ] 全片时长、结尾和口播收束没有明显截断。
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "输出成品验收摘要"
```

---

### Task 7: 文档与真实运行入口收口

**Files:**
- Modify: `harness/README.md`
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `package.json`

- [ ] **Step 1: 补 README**

在 `harness/README.md` 增加“成品验收 live-check”小节，包含：

```md
### 成品验收 live-check

该入口会显式调用真实 DashScope TTS 与文生图，并用 Remotion 导出 MP4。它不是默认自动化 gate。

```bash
npm run harness:product-acceptance-live-check -- --source-dir harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1
```

默认行为：

- 重新执行 asset planning。
- 执行真实 TTS、真实生图、本地字幕、本地 BGM。
- 删除 execution plan 中的 `video_clip` 和 `sfx_cue`，避免图生视频成本和占位 SFX。
- 验收字幕 artifact、`caption_count`、`subtitle_style` 和 Remotion `subtitle_cue_count`。
```

- [ ] **Step 2: 增加 CLI main**

在文件末尾加入：

```ts
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runProductAcceptanceLiveCheck(
    parseProductAcceptanceLiveCheckCliArgs(process.argv.slice(2)),
  )
    .then((result) => {
      console.log(
        `成品验收样片已生成：${result.summary.output_mp4_path ?? result.outputDir}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 3: 运行非真实 focused 测试**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add harness/README.md harness/scripts/runtime/product-acceptance-live-check.ts package.json
git commit -m "记录成品验收显式运行入口"
```

---

### Task 8: 缺少 source 时显式生成一组上游样本

**Files:**
- Modify: `harness/scripts/runtime/product-acceptance-live-check.ts`
- Modify: `tests/harness/product-acceptance-live-check.test.ts`

- [ ] **Step 1: 写失败测试**

新增 CLI 和 source resolution 测试：

```ts
import {
  resolveProductAcceptanceSourceDir,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

it("parses explicit upstream generation fallback", () => {
  expect(
    parseProductAcceptanceLiveCheckCliArgs(["--allow-upstream-generation"]),
  ).toMatchObject({
    allowUpstreamGeneration: true,
  });
});

it("generates a source directory only when fallback is explicit", async () => {
  const generated = await resolveProductAcceptanceSourceDir(
    {
      outputDir: "out",
      allowUpstreamGeneration: true,
    },
    {
      defaultSourceDirs: ["missing-source"],
      exists: () => false,
      generateSource: async () => "out/generated-source/storyboard/round-1",
    },
  );

  expect(generated).toBe("out/generated-source/storyboard/round-1");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "upstream generation"
```

Expected: FAIL。

- [ ] **Step 3: 实现 source resolution**

实现：

```ts
const DEFAULT_ACCEPTANCE_SOURCE_DIRS = [
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-2",
  "harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-3",
].map((item) => resolve(process.cwd(), item));

export async function resolveProductAcceptanceSourceDir(
  input: ProductAcceptanceLiveCheckInput,
  dependencies: {
    defaultSourceDirs?: string[];
    exists?: (path: string) => boolean;
    generateSource?: () => Promise<string>;
  } = {},
): Promise<string> {
  const exists = dependencies.exists ?? existsSync;
  if (input.sourceDir) {
    const resolved = resolve(process.cwd(), input.sourceDir);
    if (!exists(resolved)) {
      throw new Error(`product_acceptance_source_dir_missing: ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of dependencies.defaultSourceDirs ?? DEFAULT_ACCEPTANCE_SOURCE_DIRS) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  if (input.allowUpstreamGeneration) {
    const generateSource =
      dependencies.generateSource ?? (() => generateProductAcceptanceUpstreamSource(input));
    return generateSource();
  }

  throw new Error("product_acceptance_source_missing_use_allow_upstream_generation");
}
```

- [ ] **Step 4: 实现显式上游生成 fallback**

复用现有脚本，不复制 topic/script/storyboard 编排：

```ts
import { runTopicScriptSmoke } from "./topic-script-smoke";
import { runStoryboardFiveRoundQualityCheck } from "./storyboard-five-round-quality-check";

async function generateProductAcceptanceUpstreamSource(
  input: ProductAcceptanceLiveCheckInput,
): Promise<string> {
  const outputRoot = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  const topicScriptDir = resolve(outputRoot, "generated-source/topic-script");
  const storyboardDir = resolve(outputRoot, "generated-source/storyboard");

  await runTopicScriptSmoke({
    samplePath: "harness/samples/topic-script/yanzi-shichu.sample.json",
    outputDir: topicScriptDir,
  });
  await runStoryboardFiveRoundQualityCheck({
    sourceDir: topicScriptDir,
    outputDir: storyboardDir,
    rounds: 1,
  });

  return resolve(storyboardDir, "round-1");
}
```

注意：这一步会调用真实 LLM，只能通过显式 `--allow-upstream-generation` 触发。

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npx vitest run --configLoader runner tests/harness/product-acceptance-live-check.test.ts -t "upstream generation"
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add harness/scripts/runtime/product-acceptance-live-check.ts tests/harness/product-acceptance-live-check.test.ts
git commit -m "支持成品验收显式生成上游样本"
```

---

### Task 9: 手动真实 live-check

**Files:**
- No code change unless failure reveals a bug.

- [ ] **Step 1: 确认环境**

确认 `.env` 或 `backend/.env` 中至少有：

```text
ALIYUN_DASHSCOPE_API_KEY=...
ALIYUN_DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL=wan2.6-t2i
ALIYUN_DASHSCOPE_TTS_MODEL=qwen3-tts-instruct-flash
```

- [ ] **Step 2: 运行单样本验收**

Run:

```bash
npm run harness:product-acceptance-live-check -- --source-dir harness/scripts/runtime/output/2026-05-10-storyboard-five-theme-review/round-1 --output-dir harness/scripts/runtime/output/product-acceptance-live-check-round-1
```

Expected:

- 命令结束时输出 MP4 路径。
- `acceptance-summary.json.status` 为 `sample-ready`。
- `subtitle_diagnostics.cue_count > 0`。
- `audio_diagnostics.tts.rms > 0`。
- `audio_diagnostics.bgm.rms > 0`。
- `disabled_sfx_confirmed = true`。
- `image_to_video_not_called_confirmed = true`。

- [ ] **Step 3: 如果失败，先不扩大范围**

按错误码处理：

- `product_acceptance_dashscope_api_key_missing`：补环境变量。
- `acceptance_visual_anchor_missing`：换 source 样本或单独设计 execution plan fallback，不临时启用图生视频。
- `product_acceptance_subtitles_not_rendered`：检查 `subtitle_track` artifact 和 Remotion input props。
- `product_acceptance_audio_not_rendered`：检查 Remotion audio clips 和 data URI 转换。

- [ ] **Step 4: 成功后记录结果**

不提交 `harness/scripts/runtime/output/**` 生成物。只在最终回复中提供：

- MP4 绝对路径。
- `acceptance-summary.json` 关键字段。
- 字幕 cue 数量。
- BGM library item id。
- TTS/image provider names。

---

## 自审清单

- 覆盖字幕：有 Task 5 render readiness，Task 6 summary，Task 7 README，Task 9 真实验收检查。
- 覆盖禁用 SFX：Task 3 删除 `sfx_cue`，Task 6 检查无 `sfx_audio`，Task 9 验收。
- 覆盖不跑图生视频：Task 3 删除 `video_clip`，Task 6 检查无 `dashscope_image_to_video` 和 `video` artifact。
- 覆盖真实 TTS 和真实生图：Task 4 使用 `provider_mode="dashscope"`，Task 9 显式真实运行。
- 覆盖 BGM：Task 4 seed media library，Task 6 summary 记录 `bgm_audio`。
- 无新增依赖。
- 不触碰 `storage/topic-candidate-library/`。
- 不提交 `storage/media-library/` 或 output 生成物。
