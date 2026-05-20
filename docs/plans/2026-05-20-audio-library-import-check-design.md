# 真实音频素材导入校验设计

## 背景

当前 BGM/SFX 已完成离线本地媒体库选择、deterministic WAV fixture 物化、compose/renderer 消费、默认音频素材库 seed、BGM 缺失告警以及 Remotion fade/loop 渲染。默认素材库仍是 metadata-first / license-evidence-first：它记录候选素材的标签、来源和授权意图，但 `file_hash` 仍允许 `sha256:pending-*`，不代表真实第三方音频文件已经下载、验真或可发布使用。

下一步需要建立一个小而可审查的“真实音频文件导入校验”能力，让用户自己下载或提供的本地音频文件，在进入 `MediaLibraryItem` 前经过结构校验、授权证据校验、真实 SHA-256 计算、时长探测和 approval 约束。第一版只处理本地文件导入，不做网络下载器。

## 目标

- 支持把用户已经放到本地的 WAV 音频文件导入到 media library。
- 导入时计算真实 `sha256:<hex>`，禁止 approved 条目继续使用 `sha256:pending-*`。
- 导入时探测 WAV 时长，并写入 `duration_sec`。
- 导入时保留 `source_url`、license 类型、商业可用性、归因文本和标签。
- 导入时把文件复制到项目 storage 下的稳定 library 目录，而不是引用任意外部路径。
- 保持 BGM/SFX 仍为可选素材；导入失败不影响 TTS、image、compose、renderer 主链路。
- 为后续下载器、上传 UI、归因包装提供后端合同基础。

## 不做范围

- 不自动从网页下载音频。
- 不抓取网页授权文本，不做网页内容爬取或法律判断。
- 不引入新依赖解析 MP3/OGG；第一版只支持 WAV。
- 不接真实付费 BGM/SFX provider。
- 不做上传 UI、预览 UI、发布流、人工审稿流。
- 不做 ducking、响度归一化、波形分析、节拍同步或自动剪辑。
- 不提交第三方音频二进制文件；测试只用临时生成的 WAV fixture。
- 不触碰 `storage/topic-candidate-library/`。

## 当前基线

- `shared/src/assets/media-library.schema.ts` 已有 `MediaLibraryItem` 和 `MediaLibraryLicense`。
- `MediaLibraryItem` 已包含 `library_item_id`、`type`、`file_uri`、`mime_type`、`duration_sec`、`loopable`、`tags`、`mood_tags`、`license`、`file_hash`、`imported_at`、`approved_for_use`。
- `MediaLibraryLicense` 已包含 `license_type`、`commercial_use_allowed`、`attribution_required`、`attribution_text`、`source_url`。
- `backend/src/modules/assets/assets-file-storage.ts` 已有 `hashFileSha256()` 与 `copyAssetFile()`，但 copy 当前面向 assets run，不适合长期 media library 目录。
- `backend/src/modules/assets/audio-duration-probe.ts` 已支持 WAV duration 探测和显式 PCM duration 探测。
- `backend/src/modules/assets/media-library.repository.ts` 已支持 save/get/list/seed，但没有导入校验 helper。
- `backend/src/modules/assets/default-audio-library.ts` 当前允许 `sha256:pending-*`，这是 seed 合同，不应直接代表 approved 的真实文件。

## 设计决策

### 决策 0：默认 seed 降级为未批准候选

当前 `DEFAULT_AUDIO_LIBRARY_ITEMS` 仍是 `approved_for_use=true` 且 `file_hash=sha256:pending-*`。这对早期 smoke 有用，但和“真实素材可发布使用”语义冲突。进入导入校验后，默认 seed 应改为 `approved_for_use=false`：它只表达候选标签和授权线索，不再被 selector 选中。runtime smoke 需要改为用临时 WAV fixture 走 import-check 生成真实 hash 后再保存为 approved item。

### 决策 1：第一版只做本地文件导入

真实素材的来源获取由用户或后续工具完成。导入函数只接收一个本地 `sourceFilePath`，并要求调用方显式提供 `source_url` 和 license metadata。这样避免 agent 默认联网下载第三方素材，也避免把授权判断伪装成自动化能力。

### 决策 2：导入文件复制到项目 storage 的 media library 目录

导入后 `file_uri` 指向项目 storage 下的长期库文件，例如：

```text
<projectStorageRootDir>/media-library/audio/bgm/<library_item_id>.wav
<projectStorageRootDir>/media-library/audio/sfx/<library_item_id>.wav
```

原因：

- 不依赖用户原始下载目录继续存在。
- 后续 provider 与 renderer 能消费稳定路径。
- 与 assets run 输出区分：media library 是长期库，assets run 是一次执行产物。

### 决策 3：approved 条目必须使用真实 hash

`sha256:pending-*` 只允许存在于默认 seed 或未批准草稿中。只要 `approved_for_use=true`，导入结果必须写入真实 `sha256:<64 hex>`。如果调用方尝试批准 pending hash，应返回结构化失败。

### 决策 4：第一版支持 WAV，其他格式先拒绝

现有 duration probe 已能可靠读取 WAV。MP3/OGG 需要额外解析或依赖，第一版不新增依赖，先返回 `unsupported_audio_format`。后续如果需要 MP3/OGG，再单独设计。

### 决策 5：授权证据由结构字段承载，不做语义裁判

导入校验只检查字段是否存在、是否符合结构约束：

- `source_url` 必须是 URL。
- `commercial_use_allowed=true` 才允许 approved。
- `attribution_required=true` 时必须有 `attribution_text`。

它不判断网页内容是否真的等于 CC0，也不判断素材是否侵权。这个判断仍属于人工素材运营或后续更强的审核流程。

## 输入合同

新增导入输入类型建议放在后端模块内：

```ts
export interface ImportAudioLibraryItemInput {
  projectStorageRootDir: string;
  sourceFilePath: string;
  libraryItemId: string;
  type: "bgm" | "sfx";
  loopable: boolean;
  tags: string[];
  moodTags: string[];
  license: MediaLibraryLicense;
  approvedForUse: boolean;
  importedAt?: string;
}
```

第一版不把该类型放入 shared schema，因为它是后端导入命令输入，不是 pipeline 阶段输出合同。

## 输出合同

成功时返回可直接保存的 `MediaLibraryItem`：

```ts
{
  library_item_id: "bgm_tense_dark_drone_001",
  type: "bgm",
  file_uri: "D:\\...\\storage\\media-library\\audio\\bgm\\bgm_tense_dark_drone_001.wav",
  mime_type: "audio/wav",
  duration_sec: 45.2,
  loopable: true,
  tags: ["background", "drone"],
  mood_tags: ["tense", "dark"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
    source_url: "https://example.com/source-page"
  },
  file_hash: "sha256:<64 hex>",
  imported_at: "2026-05-20T00:00:00.000Z",
  approved_for_use: true
}
```

失败时第一版可抛出明确错误码字符串，例如：

- `audio_library_import_source_missing`
- `audio_library_import_unsupported_format`
- `audio_library_import_duration_unreadable`
- `audio_library_import_source_url_required`
- `audio_library_import_commercial_license_required`
- `audio_library_import_attribution_text_required`
- `audio_library_import_tags_required`
- `audio_library_import_invalid_library_item_id`

## 文件存储规则

新增 storage helper：

```ts
resolveMediaLibraryAudioPath({
  projectStorageRootDir,
  type,
  libraryItemId,
})
```

输出：

- `absolutePath`
- `fileUri`
- `relativePath`

路径必须位于 `<projectStorageRootDir>/media-library/audio/<type>/` 下。`libraryItemId` 第一版只允许 `[a-z0-9_\\-]+`，避免路径穿越和跨平台非法字符。

## 校验规则

- `sourceFilePath` 必须存在且可读。
- 第一版只允许 `.wav` 或 RIFF WAVE 内容。
- `duration_sec` 必须从真实文件探测得到，且大于 0。
- `tags` 至少 1 个；BGM 建议包含 `background`，但第一版只做 warning/文档建议，不做硬门禁。
- `source_url` 必填。
- `approvedForUse=true` 时，`license.commercial_use_allowed` 必须为 true。
- `license.attribution_required=true` 时，`license.attribution_text` 必填。
- 输出 `file_hash` 必须是实际复制后的文件 hash。

## 和现有链路的关系

- selector 仍只选择 `approved_for_use=true` 且 `commercial_use_allowed=true` 的条目。
- local BGM/SFX provider 第一版仍可用 deterministic WAV fixture 物化 artifact；后续可单独设计“直接复制真实 media library 文件到 assets run”。
- compose/renderer 不需要改语义；它们只消费已存在的 artifact。
- 默认 seed 仍保留，但应为未批准候选；只有完成导入并替换真实 hash 的条目才代表真实素材可用。

## 验收标准

- 能从临时 WAV fixture 导入一个 BGM 条目，保存到 `media-library/audio/bgm`，生成真实 hash 和真实 duration。
- 能从临时 WAV fixture 导入一个 SFX 条目，保存到 `media-library/audio/sfx`。
- 缺少 `source_url`、非商业授权、需要归因但无文本、非 WAV 文件、非法 `library_item_id` 均被拒绝。
- 导入后的 item 能通过 `MediaLibraryItem.parse()`。
- 导入后的 approved item 能被 `selectMediaLibraryItem()` 选中。
- 默认 seed 不再作为 approved pending hash 被 selector 选中。
- runtime smoke 通过 import-check 注入真实 hash 的本地 WAV fixture，而不是直接选中 pending seed。
- focused tests 通过，不需要真实网络，不提交第三方音频。
