# 发布交付包阶段设计：封面 / 标题 / 描述 / 话题标签

日期：2026-06-17
状态：draft
相关文档：
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/schema-design.md`
- `docs/data/field-design.md`

---

## 一、问题定义

当前流水线终点是 render/export：生成视频文件 + render 页下载。但用户最终要在一个或多个平台（抖音、B 站、YouTube 等）发布视频，需要配套的封面、标题、描述和话题标签。这些交付物不属于 topic/script/storyboard/asset/compose/render 任何现有阶段的职责。

现有缺位：
1. 封面没有生成或选择入口。用户只能手动截图。
2. 发布标题只能用 TopicPackage.title，但它更适合做项目名，不是短视频平台标题。
3. 描述和话题标签完全缺失，用户只能每次手写。
4. 上述交付物如果散落在 render、asset 或 UI 层，会导致职责耦合和不可逆变更风险。

---

## 二、设计目标

在 render 之后新增一个独立流水线阶段：**发布交付包（publish package）**。该阶段：
- 消费上游的 TopicPackage、ScriptRecord、StoryboardRecord、AssetManifest、RenderJobRecord。
- 生成封面候选、标题候选、描述和话题标签。
- 不阻塞、不改变上游输出。
- 失败不影响视频生成和重渲染。

---

## 三、数据合同：PublishPackage

### 3.1 新增 shared schema

```typescript
// shared/src/publish/publish-package.schema.ts

export const PublishPackage = z.object({
  package_version: z.literal("publish_package_v1"),
  source_render_job_record_id: z.string(),
  source_topic_package_id: z.string(),
  source_script_record_id: z.string(),
  source_storyboard_record_id: z.string(),
  source_asset_manifest_record_id: z.string(),

  // 视频 — 引用 render 产出的 ExportArtifact (render-job.schema.ts)
  source_render_job_record_id: z.string(),
  video_export_artifact_id: z.string(),   // = ExportArtifact.artifact_id

  // 封面
  selected_cover_candidate_id: z.string().nullable(),
  cover_candidates: z.array(z.object({
    candidate_id: z.string(),
    source_type: z.enum(["render_keyframe", "storyboard_image"]),
    source_artifact_id: z.string().nullable(),
    file_uri: z.string(),        // absolute or workspace-relative path
    mime_type: z.string(),       // "image/png" / "image/jpeg"
    label: z.string(),           // e.g. "0:00 关键帧" / "#1 分镜图"
    position_sec: z.number().nullable(),  // for keyframes: timestamp
  })),

  // 标题
  title_candidates: z.array(z.object({
    candidate_id: z.string(),
    text: z.string(),
    style: z.enum(["standard", "suspense", "knowledge", "emotional"]),
  })),
  selected_title: z.string(),

  // 描述
  description: z.string(),

  // 话题标签
  hashtags: z.array(z.string()),

  // 平台适配
  platform_profile: z.enum(["douyin", "bilibili", "youtube", "generic"]).default("generic"),

  // 就绪状态
  readiness: z.enum(["draft", "ready", "blocked"]),
  notes: z.array(z.string()),
}).strict();
```

### 3.2 新增后端 record

```typescript
// backend/src/db/client.ts (新增)

export interface PublishPackageRecord {
  id: string;
  projectId: string;
  renderJobRecordId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetManifestRecordId: string;
  packageJson: Record<string, unknown>; // PublishPackage
  validationResultJson: Record<string, unknown> | null;
  executionStateJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 四、功能分解

### 4.1 封面（Cover）

**输入**：
- 最终视频文件（已由 render 阶段产出）
- Storyboard 中已完成的分镜图 artifact（从 AssetManifest 获取）

**功能**：
1. 从最终视频用 ffmpeg 抽取关键帧作为候选（0s、25%、50%、75% 位置）
2. 从分镜图中选择主视觉图（#1 分镜图优先）
3. 用户从候选中选择，或上传自定义封面
4. 选定后在 PublishPackage 中记录 `selected_cover_candidate_id`

**ffmpeg 依赖与兜底**：
- ffmpeg 从 `PATH` 或 `process.env.FFMPEG_PATH` 查找；首次使用前做一次 `ffmpeg -version` 探测。
- 探测失败时封面候选**仅来自分镜图**，不报错、不阻塞，在 runtime diagnostics 中记录 `ffmpeg_unavailable_keyframes_skipped`。
- CI/测试环境：`cover_candidates` 测试默认只测分镜图分支；ffmpeg 分支用 `FFMPEG_PATH` 指向已知可执行文件。

**第一版范围**：仅支持从分镜图和视频关键帧中候选，不单独生成封面图。ffmpeg 缺失时自动降级到分镜图候选。

### 4.2 标题（Title）

**输入**：
- TopicPackage.title（默认初始化）
- TopicPackage.selected_angle
- ScriptRecord.scriptDraft
- 最终视频时长

**功能**：
1. 调用 LLM 生成 3-5 个标题候选
2. 每种风格至少一个：标准版、悬念版、知识型版、情绪版
3. 用户选择/编辑一个作为 `selected_title`
4. 不覆盖项目名（TopicPackage.title 保持不变）

**LLM prompt 要求**：
- 正式 prompt 必须放在 `harness/prompts/publish/`。
- 语言：中文。
- 输入：TopicPackage、ScriptDraft 摘要、视频时长。
- 输出：结构化标题候选数组。
- 约束：不做超出历史事实的断言，不使用纯情绪词堆砌，每条标题≤30 字。

**第一版范围**：LLM 生成标题候选 + 前端选择/编辑。

### 4.3 描述（Description）

**输入**：
- TopicPackage
- ScriptDraft（全文或摘要）
- 最终视频时长
- 平台偏好（可选）

**功能**：
1. 调用 LLM 生成一条发布描述
2. 描述应概览故事核心、历史背景、看点
3. 不超过 500 字，避免史实过度断言
4. 用户可以手动编辑

**LLM prompt 要求**：
- 正式 prompt 放在 `harness/prompts/publish/`。
- 语言：中文。
- 输出：单条描述文本。

**第一版范围**：LLM 生成单条描述 + 前端编辑。

### 4.4 话题标签（Hashtags）

**输入**：
- TopicPackage.family_label
- TopicPackage.scope_label
- ArtBible.era_style
- Storyboard 中的 narrative_role 分布
- 用户手动输入

**功能**：
1. 从上游字段派生基础标签（朝代、人物、事件、内容类型）
2. 调用 LLM 或本地规则生成补充标签
3. 输出结构化标签数组
4. 用户可新增、删除、排序

**第一版范围**：上游字段派生 + 用户手动编辑。不调用 LLM 生成标签（成本/价值比不高）。

---

## 五、API 设计

### 5.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects/:projectId` | **现有端点** — project snapshot 新增 `active_publish_package` 字段 |
| POST | `/api/projects/:projectId/publish/generate` | 生成/重新生成 PublishPackage |
| PATCH | `/api/projects/:projectId/publish` | 更新 PublishPackage 字段（标题/描述/标签/封面选择） |
| POST | `/api/projects/:projectId/publish/title/candidates` | 仅重新生成标题候选 |
| POST | `/api/projects/:projectId/publish/cover/candidates` | 重新生成封面候选（提取关键帧等） |

前端通过 project snapshot 的 `active_publish_package` 恢复状态，
不新增独立的 GET endpoint。PATCH 只修改当前 active package 的可编辑字段。

### 5.2 Active pointer & stale 策略

`ProjectRecord` 新增字段：

```typescript
activePublishPackageRecordId: string | null;
```

- render 成功完成后，旧 `activePublishPackageRecordId` 标记 stale。
- 用户进入 `/publish` 页时，如果 `activePublishPackageRecordId` 为 null 或 stale，前端提示"需要重新生成发布包"。
- Stale 检测：比较 `PublishPackageRecord.source_render_job_record_id` 与当前 `ProjectRecord.activeRenderJobRecordId`。
- 不打自动重新生成；用户点击"重新生成发布信息"触发。

### 5.3 读取路径

前端 store `loadProject()` → `GET /api/projects/:projectId` → project snapshot 的 `active_publish_package` 字段，结构与 `active_render` 对齐：

```typescript
active_publish_package: {
  publish_package_record_id: string;
  source_render_job_record_id: string;
  readiness: "draft" | "ready" | "blocked";
  video_export_artifact: ExportArtifact | null;  // 摘要，来自 render output
  cover_candidates: CoverCandidate[];
  selected_cover_candidate_id: string | null;
  title_candidates: TitleCandidate[];
  selected_title: string;
  description: string;
  hashtags: string[];
  platform_profile: string;
} | null;
```

### 5.4 PublishPackage 生命周期

1. `draft`：初始生成后，用户尚未编辑完成。
2. `ready`：所有必填字段已确认，可导出。
3. `blocked`：必填字段缺失或上游数据不可用。

---

## 六、前端设计

### 6.1 新增页面：`发布准备`（publish）

- 路由：`/projects/:projectId/publish`
- 位置：render 之后，作为最后一个侧边栏步骤

### 6.2 布局

左侧（视频预览区）：
- 最终视频播放器
- 视频基本信息（时长、分辨率、文件大小）

右侧（编辑区）：
- 封面候选区：3-5 个候选缩略图 + 选择按钮 + 上传按钮
- 标题编辑区：标题候选列表 + 选择/编辑 + 文本框
- 描述编辑区：文本编辑框
- 话题标签区：标签列表 + 新增/删除

底部操作：
- "重新生成发布信息"（调用 LLM 重新生成标题/描述）
- "导出发布包"（下载 cover + title + description + hashtags 的 JSON 包）

### 6.3 状态指示

- draft 状态：显示"未完成"，提示需要确认标题/封面
- ready 状态：显示"已就绪"，可导出
- generating 状态：显示生成进度

---

## 七、与现有阶段的边界

| 不做什么 | 原因 |
|----------|------|
| 不在 topic 阶段生成标题 | 太早，缺乏视频时长和成片内容 |
| 不在 render 阶段生成封面 | render 应只管视频文件 |
| 不把发布信息写入 ProjectSummary | 需要版本、编辑、校验和导出状态 |
| 不在 asset 阶段处理封面 | 封面不是素材，是交付物 |
| 不调用真实平台 API 发布 | 第一版只做"生成并编辑发布包" |

---

## 八、第一版不做的

- 真实平台 API 发布
- 封面文案叠字/模板
- 多平台配置（抖音/B站/YouTube 独立配置）
- 发布历史/版本管理
- A/B 标题测试
- 自动封面图生成（LLM image generation for cover）

---

## 九、对现有链路的影响

- 无。新阶段是纯消费者，不写回上游 record。
- 前端新增一个侧边栏步骤，WORKSPACE_STEPS 新增 `publish`。
- 后端新增 `registerPublishRoutes`，`db` 新增 `publishPackageRecords` Map。
