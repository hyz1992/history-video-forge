# 发布交付包阶段实施计划：封面 / 标题 / 描述 / 话题标签

日期：2026-06-17
前置设计：[2026-06-17-publish-package-stage-design.md](./2026-06-17-publish-package-stage-design.md)
状态：draft（修订版：补齐 active pointer、读取路径、ffmpeg 兜底）

---

## 总体策略

小步实现，每步一个独立提交。按 TDD 推进：先写失败测试，再写最小实现，再回归验证。

## 任务分解

### Phase 1：shared schema + active pointer + 后端骨架（不依赖 LLM）

**Task 1.1**：新增 shared schema `PublishPackage`
- 文件：`shared/src/publish/publish-package.schema.ts`
- 字段按设计 doc 的 3.1 节（含 `video_export_artifact_id`、`cover_candidates.file_uri/mime_type/position_sec`）
- 验证：Zod schema 单元测试

**Task 1.2**：`ProjectRecord` 新增 `activePublishPackageRecordId`
- 文件：`backend/src/db/client.ts`
- 验证：相关后端测试通过

**Task 1.3**：新增 `PublishPackageRecord` + repository
- 文件：`backend/src/db/client.ts`（类型）、`backend/src/modules/publish/publish-record.repository.ts`
- 功能：`savePublishPackageRecord`、`getPublishPackageRecordById`
- 验证：单元测试

**Task 1.4**：project snapshot 挂载 `active_publish_package`
- 文件：`backend/src/modules/projects/project-snapshot.service.ts`
- 当 `project.activePublishPackageRecordId` 存在时，在 snapshot 中返回 `active_publish_package`
- 包含**运行时 stale 检测**（不落库）：比较 `PublishPackageRecord.source_render_job_record_id` 与 `project.activeRenderJobRecordId`，不匹配时设置 `is_stale: true` + `stale_reason: "render_output_changed"`
- 验证：project-snapshot 测试（含 stale 场景）

**Task 1.5**：后端 publish API 骨架
- 文件：`backend/src/modules/publish/publish.routes.ts`
- 端点：
  - `POST /api/projects/:projectId/publish/generate` — 首版仅从上游字段拼基础数据（无 LLM）
  - `PATCH /api/projects/:projectId/publish` — 更新可编辑字段
- generate 逻辑：设置 `project.activePublishPackageRecordId`，标记旧 publish record 为 stale
- 验证：API 测试（200 / 404 / 409 / stale）

### Phase 2：封面候选

**Task 2.1**：ffmpeg 探测 + 关键帧提取
- 文件：`backend/src/modules/publish/cover-candidates.service.ts`
- ffmpeg 从 `PATH` 或 `FFMPEG_PATH` 查找；探测失败 → 仅分镜图候选 + `ffmpeg_unavailable` diagnostics
- 成功时：从视频 0s、25%、50%、75% 位置截图
- 验证：smoke 测试（fake mp4 走分镜图分支；ffmpeg 可用时测截图）

**Task 2.2**：分镜图候选收集
- 读取 `AssetManifest.artifacts`，过滤类型为 `image` 且有真实 file_uri 的 artifact
- 优先 #1 分镜图在前

**Task 2.3**：封面候选 API
- 端点：`POST /api/projects/:projectId/publish/cover/candidates`
- 返回：合并的候选列表，每条带 `file_uri/mime_type/label/position_sec`
- 验证：API 测试（ffmpeg 可用/不可用两条路径）

### Phase 3：标题候选（LLM）

**Task 3.1**：新增 LLM prompt
- 文件：`harness/prompts/publish/title-generator.prompt.md`
- 语言：zh-CN；输出：3-5 条标题候选，每条带 style
- 约束：不超出历史事实断言，每条≤30 字，不使用纯情绪词堆砌
- 验证：prompt-runtime 测试

**Task 3.2**：标题生成服务 + API
- 文件：`backend/src/modules/publish/title-generator.service.ts`
- 端点：`POST /api/projects/:projectId/publish/title/candidates`
- 验证：stub / mock LLM 测试 + API 测试

### Phase 4：描述生成（LLM）

**Task 4.1**：新增 LLM prompt
- 文件：`harness/prompts/publish/description-generator.prompt.md`
- 语言：zh-CN；输入 TopicPackage/ScriptDraft/视频时长；输出单条描述
- 约束：不超过 500 字，避免史实过度断言
- 验证：prompt-runtime 测试

**Task 4.2**：描述生成服务 + 集成到 generate
- 文件：`backend/src/modules/publish/description-generator.service.ts`
- 在 `POST /api/projects/:projectId/publish/generate` 中调用（Phase 1 的 generate 升级为完整版）
- 验证：API 测试

### Phase 5：标签派生（非 LLM，需在 Phase 6 前端前完成）

**Task 5.1**：标签本地派生服务
- 文件：`backend/src/modules/publish/hashtag-derivation.service.ts`
- 功能：从 TopicPackage（family_label/scope_label）、ArtBible（era_style）、Storyboard（narrative_role 分布）派生基础标签
- 示例输入 → 输出：`family_label="文化镇压" scope_label="清朝初期" era_style="明末清初江南历史正剧"` → `["历史", "清朝", "文字狱", "庄廷鑨明史案", "历史故事"]`
- 验证：单元测试
- 集成到 `POST generate`：生成后默认填入 `hashtags`

### Phase 6：前端

**Task 6.1**：新增 publish workspace step
- 修改：`frontend/src/stores/workspace.ts` — PIPELINE_STEPS 新增 `publish`
- 修改：`frontend/src/views/ProjectWorkspace.vue` — 注册 PublishPanel
- 修改：`frontend/src/components/workspace/WorkspaceSidebar.vue`

**Task 6.2**：新增 publish store
- 文件：`frontend/src/stores/publish.ts`
- 功能：从 project snapshot 读取 `active_publish_package`（不新增独立 GET endpoint）
- 方法：`loadProject()`（读 snapshot）、`generatePackage()`（POST）、`updatePackage()`（PATCH）
- 验证：store 测试

**Task 6.3**：新增 PublishPanel 组件
- 文件：`frontend/src/components/publish/PublishPanel.vue`
- 功能：左侧视频预览 + 封面选择 + 标题候选编辑 + 描述编辑 + 标签编辑 + 生成/导出按钮
- 状态：stale（提示重新生成）、draft（提示未完成）、ready（可导出）
- 导出按钮：下载 JSON 包（cover + title + description + hashtags）

### Phase 7：集成 & 回归

**Task 7.1**：端到端 API 测试
- 创建项目 → 走完完整流水线 → POST publish/generate → 验证字段 → PATCH 更新 → 重新 render → 验证 stale
- 验证：API 测试

**Task 7.2**：前端构建 & 手动验收
- `vite build` 通过
- 浏览器验收：render → publish → 生成 → 编辑 → stale → 重新生成

---

## 不改动的文件

- topic / script / storyboard / asset planning / assets / compose / render 任何现有服务
- 现有前端 panel 和 store（除 workspace 注册外）
- 现有 shared schema（新增文件，不修改已有文件）

## 不变更的接口合同

- 不向 TopicPackage 添加字段
- 不改变 RenderJobRecord 结构
- 不改变 AssetManifest 结构

## 验收命令

```powershell
npx vitest run --configLoader runner tests/backend/publish tests/backend/api/publish-api.test.ts --no-file-parallelism
npx vitest run --configLoader runner tests/frontend/stores/publish.test.ts
npx vite build --config frontend/vite.config.ts
```
