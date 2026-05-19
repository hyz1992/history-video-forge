# DashScope Image-to-Video Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit DashScope image-to-video assets provider that turns planned `video_clip` tasks into local `video` artifacts while preserving image + motion fallback.

**Architecture:** The provider lives in `backend/src/modules/assets/providers/dashscope/` and implements the existing `AssetProviderAdapter` interface. It is registered only when `provider_mode=dashscope` and an image-to-video model is configured, consumes same-segment `image` artifacts, downloads temporary DashScope `video_url` results to project storage, and lets existing compose/renderer consume the resulting `AssetManifest`.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, Fastify injection tests, existing assets provider engine, existing project local file storage, DashScope HTTP async API.

---

## Preconditions

- Read `AGENTS.md`.
- Read `docs/plans/2026-05-18-dashscope-image-to-video-provider-design.md`.
- Re-check official DashScope image-to-video docs before coding:
  - https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference
  - https://help.aliyun.com/zh/model-studio/wan-image-to-video-guide
- Do not call real DashScope in default tests.
- Do not implement frontend upload/preview UI.
- Do not move image-to-video into renderer.
- Do not touch `storage/topic-candidate-library/`.

## File Map

- Create `backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts`: provider payload builder and adapter.
- Create `tests/backend/assets/dashscope-image-to-video-provider.test.ts`: mocked provider unit tests.
- Modify `backend/src/modules/assets/assets-run.service.ts`: DashScope config and opt-in provider registration.
- Modify `backend/src/modules/assets/assets-execution-engine.ts`: video artifact route handling and fallback status behavior if required by failing tests.
- Modify `tests/backend/assets/assets-run-service.test.ts`: service-level opt-in tests.
- Modify `tests/backend/api/assets-api.test.ts`: API `provider_mode=dashscope` config parsing tests.
- Create `harness/scripts/runtime/assets-dashscope-image-to-video-live-check.ts`: explicit live check.
- Create `tests/harness/assets-dashscope-image-to-video-live-check.test.ts`: command registration and no-default-network guard.
- Modify `package.json`: add explicit live-check script.
- Modify `docs/records/2026-05-16-assets-stage-completion-checklist.md` only after successful implementation evidence exists.
- Modify formal docs in Task 8 after code passes.

## Task 1: Provider Payload and Source Image Resolution

**Files:**
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts`
- Test: `tests/backend/assets/dashscope-image-to-video-provider.test.ts`

- [ ] **Step 1: Write failing payload tests**

Add tests:

```ts
import { describe, expect, it } from "vitest";

import {
  buildDashscopeImageToVideoPayload,
  clampDashscopeImageToVideoDuration,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.js";

describe("DashScope image-to-video provider payload", () => {
  it("builds a Wan first-frame image-to-video payload", () => {
    const payload = buildDashscopeImageToVideoPayload({
      model: "wan2.7-i2v-2026-04-25",
      prompt: "A tense historical close-up, slow push-in.",
      sourceImageUrl: "data:image/png;base64,abc",
      resolution: "720P",
      durationSec: 5,
      promptExtend: true,
      watermark: false,
    });

    expect(payload).toEqual({
      model: "wan2.7-i2v-2026-04-25",
      input: {
        prompt: "A tense historical close-up, slow push-in.",
        media: [{ type: "first_frame", url: "data:image/png;base64,abc" }],
      },
      parameters: {
        resolution: "720P",
        duration: 5,
        prompt_extend: true,
        watermark: false,
      },
    });
  });

  it("clamps duration to the provider supported range", () => {
    expect(clampDashscopeImageToVideoDuration(1)).toBe(2);
    expect(clampDashscopeImageToVideoDuration(5)).toBe(5);
    expect(clampDashscopeImageToVideoDuration(30)).toBe(15);
  });
});
```

- [ ] **Step 2: Run payload tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-image-to-video-provider.test.ts
```

Expected: fail because `dashscope-image-to-video-provider.ts` does not exist.

- [ ] **Step 3: Implement minimal payload helpers**

Create:

```ts
export interface DashScopeImageToVideoPayloadInput {
  model: string;
  prompt: string;
  sourceImageUrl: string;
  resolution?: string;
  durationSec?: number;
  promptExtend?: boolean;
  watermark?: boolean;
}

export interface DashScopeImageToVideoPayload {
  model: string;
  input: {
    prompt: string;
    media: Array<{ type: "first_frame"; url: string }>;
  };
  parameters: {
    resolution: string;
    duration: number;
    prompt_extend: boolean;
    watermark: boolean;
  };
}

export function clampDashscopeImageToVideoDuration(value: number | undefined) {
  const normalized = Number.isFinite(value) ? Math.round(value as number) : 5;
  return Math.min(15, Math.max(2, normalized));
}

export function buildDashscopeImageToVideoPayload(
  input: DashScopeImageToVideoPayloadInput,
): DashScopeImageToVideoPayload {
  return {
    model: input.model,
    input: {
      prompt: input.prompt,
      media: [{ type: "first_frame", url: input.sourceImageUrl }],
    },
    parameters: {
      resolution: input.resolution ?? "720P",
      duration: clampDashscopeImageToVideoDuration(input.durationSec),
      prompt_extend: input.promptExtend ?? true,
      watermark: input.watermark ?? false,
    },
  };
}
```

- [ ] **Step 4: Run payload tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-image-to-video-provider.test.ts
```

Expected: payload tests pass.

## Task 2: Provider Adapter With Mocked Submit/Poll/Download

**Files:**
- Modify: `backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts`
- Modify: `tests/backend/assets/dashscope-image-to-video-provider.test.ts`

- [ ] **Step 1: Add failing adapter test**

Extend the test file with a mocked fetch flow:

```ts
it("submits, polls, downloads, and normalizes a video artifact", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url);
    calls.push(urlText);

    if (urlText.endsWith("/video-synthesis")) {
      expect(init?.headers).toMatchObject({
        "X-DashScope-Async": "enable",
      });
      return new Response(JSON.stringify({
        output: { task_id: "task_i2v_001" },
      }), { status: 200 });
    }

    if (urlText.endsWith("/api/v1/tasks/task_i2v_001")) {
      return new Response(JSON.stringify({
        output: {
          task_id: "task_i2v_001",
          task_status: "SUCCEEDED",
          video_url: "https://dashscope-result.test/video.mp4",
        },
        usage: {
          output_video_duration: 5,
          SR: 720,
        },
      }), { status: 200 });
    }

    if (urlText === "https://dashscope-result.test/video.mp4") {
      return new Response("fake mp4", { status: 200 });
    }

    return new Response("unexpected", { status: 500 });
  }));

  const adapter = createDashscopeImageToVideoProvider({
    apiKey: "test-key",
    baseUrl: "https://dashscope.test",
    model: "wan2.7-i2v-2026-04-25",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
  });

  const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
  const prepared = await adapter.prepare(ctx);
  const submitted = await adapter.submit(ctx, prepared);
  const polled = await adapter.poll(ctx, submitted);
  const downloaded = await adapter.download(ctx, polled);
  const normalized = await adapter.normalizeResult({
    ctx,
    downloadedArtifacts: downloaded,
    rawResponseJson: polled.rawResponseJson,
  });

  expect(normalized.artifacts[0]).toMatchObject({
    artifact_type: "video",
    origin: "provider",
    metadata: {
      provider_name: "dashscope_image_to_video",
      provider_job_id: "task_i2v_001",
      source_image_artifact_id: "artifact_img_001",
      model: "wan2.7-i2v-2026-04-25",
    },
  });
  expect(calls.some((url) => url.includes("/video-synthesis"))).toBe(true);
  expect(existsSync(normalized.artifacts[0]!.file_uri)).toBe(true);
});
```

The helper `makeVideoProviderContextWithImageArtifact(tempDir)` must create:

- one `video_clip` execution with `task_id=task_video_001`;
- one same-segment image artifact with `artifact_id=artifact_img_001`;
- one segment route whose `fallback_visual_artifact_id` or `primary_visual_artifact_id` points to `artifact_img_001`;
- a real local image file under `tempDir`.

- [ ] **Step 2: Run adapter test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-image-to-video-provider.test.ts
```

Expected: fail because adapter functions are not implemented.

- [ ] **Step 3: Implement adapter**

Implement `createDashscopeImageToVideoProvider(options)` with:

- `providerName: "dashscope_image_to_video"`
- `providerType: "video"`
- `canHandle: ({ taskType }) => taskType === "video_clip"`
- `prepare(ctx)` resolving same-segment source image and building payload
- `submit(ctx, prepared)` posting to `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`
- `poll(ctx, submitted)` polling `${baseUrl}/api/v1/tasks/${taskId}` until success/failure/max attempts
- `download(ctx, pollResult)` downloading `video_url` to `videos/dashscope_${ctx.execution.task_id}.mp4`
- `normalizeResult(input)` returning downloaded artifacts and note `dashscope image-to-video generated`

Use `resolveAssetsRunStorage()` and `writeAssetFile()` for storage.

- [ ] **Step 4: Run adapter test and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-image-to-video-provider.test.ts
```

Expected: all provider tests pass.

## Task 3: Route Update and Fallback Behavior

**Files:**
- Modify: `backend/src/modules/assets/assets-execution-engine.ts`
- Test: `tests/backend/assets/assets-execution-engine.test.ts`
- Test: `tests/backend/assets/assets-local-validator.test.ts`

- [ ] **Step 1: Add failing engine route test**

Add a test where:

- manifest has one `image` artifact for `sb_001`;
- manifest has one `video_clip` execution for `sb_001`;
- registry contains a fake adapter returning one `video` artifact;
- after `executeAssetManifest`, route is `visual_route_type=video_clip`;
- `primary_visual_artifact_id` is the video artifact;
- `fallback_visual_artifact_id` remains the image artifact.

Expected assertion:

```ts
expect(route?.visual_route_type).toBe("video_clip");
expect(route?.primary_visual_artifact_id).toBe("artifact_video_task_video_001");
expect(route?.fallback_visual_artifact_id).toBe("artifact_img_001");
```

- [ ] **Step 2: Run engine tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-execution-engine.test.ts
```

Expected: fail if the engine does not apply `video` artifacts to segment routes.

- [ ] **Step 3: Implement minimal route handling**

In `applyArtifactRoutes`, add:

```ts
case "video": {
  const segmentId = planTask.source_segment_id;
  const route = manifest.segment_routes.find(
    (item) => item.segment_id === segmentId,
  );
  if (!route) break;

  if (!route.fallback_visual_artifact_id && route.primary_visual_artifact_id) {
    route.fallback_visual_artifact_id = route.primary_visual_artifact_id;
  }
  route.primary_visual_artifact_id = artifact.artifact_id;
  route.visual_route_type = "video_clip";
  route.readiness = "ready";
  break;
}
```

- [ ] **Step 4: Run engine and validator tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-local-validator.test.ts
```

Expected: pass.

## Task 4: Register Provider Behind Explicit DashScope Config

**Files:**
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Test: `tests/backend/assets/assets-run-service.test.ts`

- [ ] **Step 1: Add failing service test**

Add a mocked DashScope test with a fixture `AssetPlan` containing:

- `tts_audio`;
- `subtitle_track`;
- `image_still`;
- `render_motion_cue`;
- `video_clip` for the same segment.

Call `runAssetsGeneration` with:

```ts
providerMode: "dashscope",
dashscope: {
  apiKey: "test-key",
  baseUrl: "https://dashscope.test",
  ttsModel: "qwen3-tts-instruct-flash",
  imageModel: "wan2.6-t2i",
  imageToVideoModel: "wan2.7-i2v-2026-04-25",
  imageToVideoPollIntervalMs: 0,
  imageToVideoMaxPollAttempts: 1,
}
```

Assert:

```ts
expect(manifest.artifacts.some((a) => a.artifact_type === "video")).toBe(true);
expect(manifest.segment_routes[0]?.visual_route_type).toBe("video_clip");
expect([...db.assetProviderJobRecords.values()].some(
  (job) => job.providerName === "dashscope_image_to_video",
)).toBe(true);
```

- [ ] **Step 2: Run service test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts -t "dashscope"
```

Expected: fail because the video provider is not registered.

- [ ] **Step 3: Extend DashScope config and registry**

In `assets-run.service.ts`:

- add config fields:
  - `imageToVideoModel?: string`
  - `imageToVideoResolution?: string`
  - `imageToVideoDurationSec?: number`
  - `imageToVideoPollIntervalMs?: number`
  - `imageToVideoMaxPollAttempts?: number`
- read environment:
  - `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`
  - `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION`
  - `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC`
  - `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS`
  - `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS`
- register `createDashscopeImageToVideoProvider()` after image provider.

Default model fallback:

```ts
imageToVideoModel:
  input?.imageToVideoModel ??
  process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL ??
  "wan2.7-i2v-2026-04-25"
```

- [ ] **Step 4: Run service tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: pass.

## Task 5: API Request Parsing

**Files:**
- Modify: `backend/src/modules/assets/assets.routes.ts`
- Test: `tests/backend/api/assets-api.test.ts`

- [ ] **Step 1: Add failing API test**

Extend existing DashScope API test payload:

```json
{
  "execution_mode": "auto_available",
  "provider_mode": "dashscope",
  "dashscope": {
    "api_key": "test-key",
    "base_url": "https://dashscope.test",
    "tts_model": "qwen3-tts-instruct-flash",
    "image_model": "wan2.6-t2i",
    "image_to_video_model": "wan2.7-i2v-2026-04-25",
    "image_to_video_resolution": "720P",
    "image_to_video_duration_sec": 5,
    "image_to_video_poll_interval_ms": 0,
    "image_to_video_max_poll_attempts": 1
  }
}
```

Assert the response manifest contains a `video` artifact and a `video_clip` route when the plan fixture includes a video task.

- [ ] **Step 2: Run API test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts -t "DashScope"
```

Expected: fail because route parsing ignores image-to-video config.

- [ ] **Step 3: Parse image-to-video config**

In `assets.routes.ts`, map snake_case fields into service camelCase:

```ts
imageToVideoModel: dashscopePayload.image_to_video_model as string | undefined,
imageToVideoResolution: dashscopePayload.image_to_video_resolution as string | undefined,
imageToVideoDurationSec: readOptionalNumber(dashscopePayload.image_to_video_duration_sec),
imageToVideoPollIntervalMs: readOptionalNumber(dashscopePayload.image_to_video_poll_interval_ms),
imageToVideoMaxPollAttempts: readOptionalNumber(dashscopePayload.image_to_video_max_poll_attempts),
```

- [ ] **Step 4: Run API test and assets regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts tests/backend/assets/assets-run-service.test.ts
```

Expected: pass.

## Task 6: Live Check Harness

**Files:**
- Create: `harness/scripts/runtime/assets-dashscope-image-to-video-live-check.ts`
- Create: `tests/harness/assets-dashscope-image-to-video-live-check.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing harness test**

Test `package.json` contains:

```ts
expect(packageJson.scripts["harness:assets-dashscope-image-to-video-live-check"]).toBe(
  "tsx harness/scripts/runtime/assets-dashscope-image-to-video-live-check.ts",
);
```

Also test the script exports a pure helper:

```ts
import { buildImageToVideoLiveCheckPlan } from "../../harness/scripts/runtime/assets-dashscope-image-to-video-live-check";

expect(buildImageToVideoLiveCheckPlan().tasks.some(
  (task) => task.task_type === "video_clip",
)).toBe(true);
```

- [ ] **Step 2: Run harness test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/harness/assets-dashscope-image-to-video-live-check.test.ts
```

Expected: fail because script and package command do not exist.

- [ ] **Step 3: Implement live-check script**

The script must:

- create a project with temporary project storage under `harness/scripts/runtime/output/assets-dashscope-image-to-video-live-check`;
- seed an `AssetPlanRecord` with one TTS task, one subtitle task, one image task, one motion task, and one video task;
- call `POST /api/projects/:projectId/assets/generate` with `provider_mode=dashscope`;
- pass image-to-video config from environment;
- write `assets-response.json`, `assets-snapshot.json`, `status.json`, and `trace.md`;
- print status JSON;
- exit non-zero if credentials are missing.

Required environment keys:

- `ALIYUN_DASHSCOPE_API_KEY`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`

Optional environment keys:

- `ALIYUN_DASHSCOPE_BASE_URL`
- `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL`
- `ALIYUN_DASHSCOPE_TTS_MODEL`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS`

- [ ] **Step 4: Register package script**

Add:

```json
"harness:assets-dashscope-image-to-video-live-check": "tsx harness/scripts/runtime/assets-dashscope-image-to-video-live-check.ts"
```

- [ ] **Step 5: Run harness unit test**

Run:

```bash
npx vitest run --configLoader runner tests/harness/assets-dashscope-image-to-video-live-check.test.ts
```

Expected: pass without network.

- [ ] **Step 6: Optional explicit live check**

Run only when the user explicitly approves a real provider call:

```bash
npm run harness:assets-dashscope-image-to-video-live-check
```

Expected when credentials are configured:

- status JSON includes `provider_names` containing `dashscope_image_to_video`;
- `artifact_types` contains `video`;
- output files are under ignored runtime output.

## Task 7: Focused Regression

**Files:** no planned production changes beyond Tasks 1-6.

- [ ] **Step 1: Run focused assets/provider tests**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/assets/dashscope-image-to-video-provider.test.ts tests/backend/assets/assets-execution-engine.test.ts tests/backend/assets/assets-local-validator.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/api/assets-api.test.ts tests/harness/assets-dashscope-image-to-video-live-check.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run downstream smoke around compose/render**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose tests/backend/api/compose-api.test.ts tests/backend/render tests/backend/api/render-api.test.ts tests/harness/render-runtime-smoke.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run diff checks**

Run:

```bash
git diff --check
git status --short
git status --short -- storage/topic-candidate-library harness/scripts/runtime/output/assets-dashscope-image-to-video-live-check
```

Expected:

- no whitespace errors;
- no `storage/topic-candidate-library/` changes;
- runtime live-check output is ignored or absent.

## Task 8: Formal Docs Sync

**Files:**
- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/records/2026-05-16-assets-stage-completion-checklist.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update docs after tests pass**

Document:

- `provider_mode=dashscope` now includes TTS, text-to-image, and image-to-video when a `video_clip` task exists;
- image-to-video remains assets-stage only;
- compose and renderer consume `video` artifacts and do not call DashScope;
- live check is explicit and not a default gate;
- missing/failed video can still use image + motion fallback.

- [ ] **Step 2: Run docs verification**

Run:

```bash
rg -n "image-to-video|图生视频|dashscope_image_to_video|video_clip|provider_mode=dashscope" docs/architecture docs/data docs/records docs/plans/README.md
git diff --check
```

Expected: docs mention the new boundary consistently and diff check passes.

## Completion Criteria

- DashScope image-to-video provider is opt-in only.
- Default fake/local tests never hit real network.
- Provider can submit, poll, download, and normalize a `video` artifact in mocked tests.
- Assets service/API can pass image-to-video config explicitly.
- Generated video artifact updates the segment route to `visual_route_type=video_clip`.
- Existing image + motion fallback remains available.
- `compose` and `renderer` tests still pass.
- Real live check exists but is explicit.
- No frontend preview/upload/publish/manual review behavior is introduced.
- `storage/topic-candidate-library/` remains untouched.
