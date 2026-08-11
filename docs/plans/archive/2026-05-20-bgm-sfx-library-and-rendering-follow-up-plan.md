# BGM/SFX 默认素材库与渲染补强实施计划

> **给执行 agent 的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。本计划使用 checkbox（`- [ ]`）跟踪进度。每个可验证任务完成后必须用中文提交。

**目标：** 建立一套小而可审查的默认 BGM/SFX 素材库工作流，并补齐三个已知缺口：BGM 淡入淡出真正渲染、BGM 可循环播放、assets 阶段对可选 BGM artifact 缺失给出更清晰的告警。

**架构：** BGM/SFX 仍归 assets 阶段负责：素材库只提供明确授权和标签化的候选素材，assets provider 把 `bgm_cue` / `sfx_cue` 解析成具体 `bgm_audio` / `sfx_audio` artifact，compose 只组织时间轴，renderer 只消费已存在的音频 props。真实下载的音频文件必须带来源、授权、hash 与人工确认；本计划第一阶段优先做 元数据优先 seed，不默认把第三方二进制音频塞进仓库。

**技术栈：** TypeScript、Zod shared schema、Vitest、现有 media-library repository、现有 assets provider adapter、现有 Remotion `Audio` / `Sequence` 渲染路径。

---

## 必读文件

执行任何任务前，先阅读：

- `AGENTS.md`
- `docs/plans/2026-05-20-bgm-sfx-design.md`
- `docs/plans/2026-05-20-bgm-sfx-implementation-plan.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `shared/src/assets/media-library.schema.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `renderer/src/timeline-props.ts`
- `renderer/src/audio-rendering.ts`
- `renderer/src/TimelineVideo.tsx`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/assets-local-validator.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/render/remotion-input-builder.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`

## 不做范围

- 不接真实付费 BGM/SFX provider。
- 不做上传 UI、预览 UI、发布流、人工审稿或质量评分。
- 不用关键词黑名单或脚本文本关键词匹配来“猜”标签。
- 不做 ducking、响度归一化、节拍同步、波形分析或自动剪音乐。
- 不跑真实 DashScope 图生视频。
- 不触碰 `storage/topic-candidate-library/`。
- 不提交下载来的第三方音频二进制，除非用户先明确批准具体来源和具体文件。

## 来源与授权策略

第一批素材优先来源：

- OpenGameArt 的 CC0 集合，尤其是页面明确标注 `License(s): CC0` 的素材。
- Pixabay 音频可以作为候选，但必须保留下载页面、license 证据和来源 URL；Pixabay 音频可用于嵌入较大创作作品的视频，但不应把素材独立再分发。

每条入库素材必须保留：

- `library_item_id`
- `type`: `bgm` 或 `sfx`
- `file_uri`
- `mime_type`
- `duration_sec`
- `loopable`
- `tags`
- `mood_tags`
- `license.license_type`
- `license.commercial_use_allowed`
- `license.attribution_required`
- `license.attribution_text`（需要署名时必填）
- `license.source_url`
- `file_hash`
- `imported_at`
- `approved_for_use`

第一批建议素材规模：

| 类型 | 数量 | 必需 tags | 情绪 tags |
|---|---:|---|---|
| BGM | 1 | `background`, `drone` | `tense`, `dark`, `slow` |
| BGM | 1 | `background`, `orchestral` | `solemn`, `historical`, `slow` |
| BGM | 1 | `background`, `ambient` | `mysterious`, `night`, `slow` |
| BGM | 1 | `background`, `percussion` | `urgent`, `battle`, `medium` |
| BGM | 1 | `background`, `calm` | `reflective`, `soft`, `slow` |
| SFX | 1 | `heartbeat` | `tense`, `close` |
| SFX | 1 | `footstep` | `quiet`, `indoor` |
| SFX | 1 | `door` | `heavy`, `indoor` |
| SFX | 1 | `hit` | `sharp`, `impact` |
| SFX | 1 | `whoosh` | `transition`, `fast` |
| SFX | 1 | `crowd` | `court`, `low` |
| SFX | 1 | `drum` | `solemn`, `impact` |
| SFX | 1 | `sword` | `metal`, `sharp` |
| SFX | 1 | `paper` | `soft`, `indoor` |
| SFX | 1 | `ambience` | `night`, `outdoor` |

---

## 文件地图

新增：

- `backend/src/modules/assets/default-audio-library.ts`  
  默认音频素材库 seed 定义。只存元数据，不联网下载。
- `tests/backend/assets/default-audio-library.test.ts`  
  验证 seed 条目、必需标签、授权证据、商用许可和稳定 ID。

修改：

- `backend/src/modules/assets/media-library.repository.ts`  
  如有需要，新增幂等 `seedMediaLibraryItems()`。
- `backend/src/modules/assets/assets-local-validator.ts`  
  增加“有 BGM placement 但未附着 artifact”的明确告警。
- `backend/src/modules/render/remotion-input-builder.ts`  
  将 BGM fade / loop 信息传给 renderer props。
- `renderer/src/timeline-props.ts`  
  扩展 audio clip props：`fadeInSec`、`fadeOutSec`、`loop`，必要时增加 `sourceDurationSec`。
- `renderer/src/audio-rendering.ts`  
  增加淡入淡出音量和循环切片纯函数。
- `renderer/src/TimelineVideo.tsx`  
  在 Remotion `<Audio>` 渲染中应用 fade 和 loop。
- `tests/backend/render/remotion-input-builder.test.ts`
- `tests/backend/assets/assets-local-validator.test.ts`
- `renderer/src/audio-rendering.test.ts`
- `tests/harness/render-runtime-smoke.test.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/plans/README.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

---

## 任务 1：默认音频素材库 seed 合同

**文件：**

- 新增：`backend/src/modules/assets/default-audio-library.ts`
- 新增：`tests/backend/assets/default-audio-library.test.ts`

- [ ] **步骤 1：先写失败测试**

创建 `tests/backend/assets/default-audio-library.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { MediaLibraryItem } from "../../../shared/src/index.js";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";

describe("default audio library seed", () => {
  it("contains a small reviewable BGM/SFX starter set", () => {
    const bgm = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm");
    const sfx = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx");

    expect(bgm.length).toBeGreaterThanOrEqual(5);
    expect(sfx.length).toBeGreaterThanOrEqual(10);
  });

  it("uses approved commercial-use items with license evidence", () => {
    for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
      expect(() => MediaLibraryItem.parse(item)).not.toThrow();
      expect(item.approved_for_use).toBe(true);
      expect(item.license.commercial_use_allowed).toBe(true);
      expect(item.license.source_url).toMatch(/^https?:\/\//);
      expect(item.file_hash).toMatch(/^sha256:/);
    }
  });

  it("keeps selector-facing tags explicit", () => {
    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm").every(
        (item) => item.tags.includes("background"),
      ),
    ).toBe(true);

    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx").every(
        (item) => item.tags.length > 0,
      ),
    ).toBe(true);
  });
});
```

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts
```

预期：失败，因为 `default-audio-library.ts` 还不存在。

- [ ] **步骤 3：实现最小 seed 模块**

创建 `backend/src/modules/assets/default-audio-library.ts`。实现要求：

- 导出 `DEFAULT_AUDIO_LIBRARY_ITEMS: MediaLibraryItem[]`。
- 至少 5 条 BGM、10 条 SFX。
- 所有条目 `approved_for_use=true`。
- 所有条目 `license.commercial_use_allowed=true`。
- 所有条目有 `license.source_url` 和 `sha256:` 前缀的 `file_hash`。
- 如果还没有真实文件，`file_hash` 可以暂用 `sha256:pending-*`，但必须在注释中说明：真实下载后必须替换为真实 SHA-256。

- [ ] **步骤 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts
```

预期：通过。

- [ ] **步骤 5：中文提交**

```bash
git add backend/src/modules/assets/default-audio-library.ts tests/backend/assets/default-audio-library.test.ts
git commit -m "新增默认音频素材库种子合同"
```

---

## 任务 2：素材库幂等 seed 写入

**文件：**

- 修改：`backend/src/modules/assets/media-library.repository.ts`
- 新增或修改：`tests/backend/assets/media-library-repository.test.ts`

- [ ] **步骤 1：先写失败测试**

测试目标：重复 seed 时不覆盖用户已有条目。

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "../../../backend/src/db/client.js";
import {
  getMediaLibraryItem,
  seedMediaLibraryItems,
} from "../../../backend/src/modules/assets/media-library.repository.js";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";

describe("media library repository", () => {
  it("seeds default items without overwriting existing approved items", async () => {
    const db = createInMemoryDb();
    const existing = {
      ...DEFAULT_AUDIO_LIBRARY_ITEMS[0]!,
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    };
    db.mediaLibraryItems.set(existing.library_item_id, existing);

    const result = await seedMediaLibraryItems(db, DEFAULT_AUDIO_LIBRARY_ITEMS);

    expect(result.inserted).toBe(DEFAULT_AUDIO_LIBRARY_ITEMS.length - 1);
    expect(result.skipped_existing).toBe(1);
    await expect(getMediaLibraryItem(db, existing.library_item_id)).resolves.toMatchObject({
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    });
  });
});
```

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-repository.test.ts
```

预期：失败，因为 `seedMediaLibraryItems` 尚未导出。

- [ ] **步骤 3：实现幂等 helper**

在 `backend/src/modules/assets/media-library.repository.ts` 增加：

```ts
export async function seedMediaLibraryItems(
  db: DbClient,
  items: MediaLibraryItem[],
): Promise<{ inserted: number; skipped_existing: number }> {
  let inserted = 0;
  let skippedExisting = 0;

  for (const item of items) {
    if (db.mediaLibraryItems.has(item.library_item_id)) {
      skippedExisting += 1;
      continue;
    }
    db.mediaLibraryItems.set(item.library_item_id, item);
    inserted += 1;
  }

  return { inserted, skipped_existing: skippedExisting };
}
```

- [ ] **步骤 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/media-library-repository.test.ts tests/backend/assets/default-audio-library.test.ts
```

预期：通过。

- [ ] **步骤 5：中文提交**

```bash
git add backend/src/modules/assets/media-library.repository.ts tests/backend/assets/media-library-repository.test.ts
git commit -m "增加音频素材库幂等种子写入"
```

---

## 任务 3：补充 BGM artifact 缺失告警

**文件：**

- 修改：`backend/src/modules/assets/assets-local-validator.ts`
- 修改：`tests/backend/assets/assets-local-validator.test.ts`

- [ ] **步骤 1：先写失败测试**

新增用例：当存在 BGM placement，但所有 placement 的 `artifact_id` 都是 `null` 时，告警 包含 `assets_bgm_artifact_missing_optional`。

```ts
expect(result.warnings).toContain("assets_bgm_artifact_missing_optional");
```

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts -t "BGM artifact"
```

预期：失败，因为告警尚未输出。

- [ ] **步骤 3：实现 告警**

在 `backend/src/modules/assets/assets-local-validator.ts` 现有 BGM 告警 附近增加：

```ts
if (
  manifest.audio_summary.bgm_placements.length > 0 &&
  manifest.audio_summary.bgm_placements.every((placement) => !placement.artifact_id)
) {
  pushUnique(warnings, "assets_bgm_artifact_missing_optional");
}
```

- [ ] **步骤 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
```

预期：通过。

- [ ] **步骤 5：中文提交**

```bash
git add backend/src/modules/assets/assets-local-validator.ts tests/backend/assets/assets-local-validator.test.ts
git commit -m "补充配乐素材缺失告警"
```

---

## 任务 4：把 BGM fade / loop 传给 renderer props

**文件：**

- 修改：`renderer/src/timeline-props.ts`
- 修改：`backend/src/modules/render/remotion-input-builder.ts`
- 修改：`tests/backend/render/remotion-input-builder.test.ts`

- [ ] **步骤 1：先写失败测试**

在 `tests/backend/render/remotion-input-builder.test.ts` 增加 BGM placement：

- `volume: 0.25`
- `fade_in_sec: 1.5`
- `fade_out_sec: 2`
- 对应 `bgm_audio.metadata.loopable: true`

断言生成的 BGM audio clip：

```ts
expect(bgmClip).toMatchObject({
  role: "bgm",
  volume: 0.25,
  fadeInSec: 1.5,
  fadeOutSec: 2,
  loop: true,
});
```

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts
```

预期：失败，因为这些字段尚未传递。

- [ ] **步骤 3：扩展 renderer prop 类型**

在 `renderer/src/timeline-props.ts` 更新 `RenderAudioClipProp`：

```ts
export interface RenderAudioClipProp {
  clipId: string;
  artifactId: string;
  role: RenderAudioRole;
  src: string;
  startSec: number;
  durationSec: number;
  volume: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  loop?: boolean;
  sourceDurationSec?: number;
}
```

- [ ] **步骤 4：在 input builder 写入 BGM 设置**

在 `backend/src/modules/render/remotion-input-builder.ts` 中，BGM clip 需要从 `BgmPlacement` 读取 `fade_in_sec` / `fade_out_sec`，从 `bgm_audio.metadata.loopable` 读取 `loop`，并把 `artifact.metadata.duration_sec` 写为 `sourceDurationSec`。

- [ ] **步骤 5：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts
```

预期：通过。

- [ ] **步骤 6：中文提交**

```bash
git add renderer/src/timeline-props.ts backend/src/modules/render/remotion-input-builder.ts tests/backend/render/remotion-input-builder.test.ts
git commit -m "传递配乐淡入淡出与循环设置"
```

---

## 任务 5：在 Remotion 音频渲染中应用 fade / loop

**文件：**

- 修改：`renderer/src/audio-rendering.ts`
- 修改：`renderer/src/TimelineVideo.tsx`
- 新增或修改：`renderer/src/audio-rendering.test.ts`

- [ ] **步骤 1：先写纯函数失败测试**

在 `renderer/src/audio-rendering.test.ts` 覆盖：

- `getFadedAudioVolume()`：淡入中点、淡出中点、无 fade、音量 clamp。
- `getAudioLoopSequences()`：例如 12 秒 clip + 5 秒源文件，拆成 `5 + 5 + 2`。

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner renderer/src/audio-rendering.test.ts
```

预期：失败，因为 helper 尚未存在。

- [ ] **步骤 3：实现纯函数**

在 `renderer/src/audio-rendering.ts` 增加：

- `getFadedAudioVolume(input)`
- `getAudioLoopSequences(input)`

要求：

- base volume 仍通过 `normalizeAudioVolume()` clamp 到 `0..1`。
- `fadeInSec <= 0` 时不淡入。
- `fadeOutSec <= 0` 时不淡出。
- loop 切片不能产生 0 秒片段。

- [ ] **步骤 4：接入 `TimelineVideo`**

在 `renderer/src/TimelineVideo.tsx` 中：

- 非 loop clip 仍渲染一个 `<Audio>`。
- loop clip 按 `getAudioLoopSequences()` 渲染多个 `<Sequence>`。
- 每个 `<Audio>` 的 `volume` 使用 `getFadedAudioVolume()`，fade 进度按整个 clip 的本地时间计算，而不是按单个 loop 片段重置。

- [ ] **步骤 5：运行 GREEN**

```bash
npx vitest run --configLoader runner renderer/src/audio-rendering.test.ts tests/backend/render/remotion-input-builder.test.ts
```

预期：通过。

- [ ] **步骤 6：中文提交**

```bash
git add renderer/src/audio-rendering.ts renderer/src/TimelineVideo.tsx renderer/src/audio-rendering.test.ts renderer/src/timeline-props.ts backend/src/modules/render/remotion-input-builder.ts tests/backend/render/remotion-input-builder.test.ts
git commit -m "实现配乐淡入淡出与循环渲染"
```

---

## 任务 6：runtime 烟测 改用默认素材库 seed

**文件：**

- 修改：`harness/scripts/runtime/render-runtime-smoke.ts`
- 修改：`tests/harness/render-runtime-smoke.test.ts`

- [ ] **步骤 1：先写失败断言**

在 `tests/harness/render-runtime-smoke.test.ts` 中断言 assets response 里存在默认 seed 产出的 BGM/SFX artifact metadata，例如：

```ts
expect(
  assetsResponse.manifest.artifacts.some(
    (artifact) =>
      artifact.artifact_type === "bgm_audio" &&
      artifact.metadata.library_item_id === "bgm_tense_dark_drone_001",
  ),
).toBe(true);
```

- [ ] **步骤 2：运行 RED**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

预期：失败，因为 smoke 仍使用临时 ad hoc seed。

- [ ] **步骤 3：改用默认 seed**

在 `harness/scripts/runtime/render-runtime-smoke.ts` 中用 `DEFAULT_AUDIO_LIBRARY_ITEMS` 写入 db，并调整 smoke 的 `bgm_cue` / `sfx_cue` 参数：

```ts
parameters: {
  required_tags: ["background", "drone"],
  mood_tags: ["tense", "dark"],
  volume: 0.25,
  fade_in_sec: 1,
  fade_out_sec: 1,
}
```

SFX：

```ts
parameters: {
  sfx_tags: ["hit"],
  mood_tags: ["sharp", "impact"],
}
```

- [ ] **步骤 4：运行 GREEN**

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

预期：通过。

- [ ] **步骤 5：运行本地 Remotion smoke**

```bash
npm run render:remotion:smoke
```

预期：`status` 为 `sample-ready`，且 `audio_clip_count >= 3`。

- [ ] **步骤 6：中文提交**

```bash
git add harness/scripts/runtime/render-runtime-smoke.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "改用默认音频素材库烟测"
```

---

## 任务 7：正式文档与 backlog 同步

**文件：**

- 修改：`docs/architecture/pipeline-io-spec.md`
- 修改：`docs/data/field-design.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **步骤 1：更新正式文档**

需要写清：

- 默认音频素材库 seed 是 元数据优先、授权证据优先。
- 真实下载或用户提供的音频必须有 source URL、license type、commercial-use flag、hash 和 approval。
- BGM fade / loop 已进入 renderer 消费字段。
- BGM/SFX 仍不包含真实付费 provider、上传 UI、ducking、响度归一化或署名包装。

- [ ] **步骤 2：更新 backlog**

可勾选：

- `[x] 默认 BGM/SFX 素材库 seed 合同`
- `[x] BGM fade/loop renderer consumption`
- `[x] 更清晰的可选 BGM artifact 缺失告警`

继续不勾选：

- real provider
- upload UI
- attribution packaging
- ducking
- loudness normalization

- [ ] **步骤 3：运行 focused 验证**

```bash
npx vitest run --configLoader runner tests/backend/assets/default-audio-library.test.ts tests/backend/assets/media-library-repository.test.ts tests/backend/assets/assets-local-validator.test.ts tests/backend/render/remotion-input-builder.test.ts renderer/src/audio-rendering.test.ts tests/harness/render-runtime-smoke.test.ts
```

预期：通过。

- [ ] **步骤 4：运行本地 Remotion smoke**

```bash
npm run render:remotion:smoke
```

预期：`sample-ready`。

- [ ] **步骤 5：中文提交**

```bash
git add docs/architecture/pipeline-io-spec.md docs/data/field-design.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步默认音频素材库与渲染补强文档"
```

---

## 执行注意事项

- 每个任务必须中文提交。
- 不要 stage 无关的 `AGENTS.md` 修改。
- 未经用户确认，不要下载真实音频文件。
- 如果后续下载真实音频，必须单独做 import-check：记录来源 URL、license 页面、下载路径、SHA-256、时长和 approval 状态。
- BGM/SFX 都是可选素材；缺失音频只能产生告警 / notes，不能阻塞 TTS、image、compose、render 主路径。

## 自审清单

- 本计划明确包含三个已知问题：fade、loop、BGM artifact 缺失告警。
- 本计划没有把真实付费 provider、上传 UI、ducking、响度归一化混进当前范围。
- 默认素材库采用 元数据优先，不默认提交第三方音频二进制。
- 每个实现任务都有 RED、GREEN 和中文提交步骤。
- 本计划不修改 topic/script/storyboard 语义链路。
