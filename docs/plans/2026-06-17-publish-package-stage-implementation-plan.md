# 发布交付包阶段实施计划：封面 / 标题 / 描述 / 话题标签

日期：2026-06-17
前置设计：[2026-06-17-publish-package-stage-design.md](./2026-06-17-publish-package-stage-design.md)
状态：draft

---

## 总体策略

小步实现，每步一个独立提交。按 TDD 推进：先写失败测试，再写最小实现，再回归验证。

## 任务分解

### Phase 1：shared schema + 后端 record（不依赖 LLM）

**Task 1.1**：新增 shared schema `PublishPackage`
- 文件：`shared/src/publish/publish-package.schema.ts`
- 验证：Zod schema 单元测试

**Task 1.2**：新增 `PublishPackageRecord` 到 db client
- 文件：`backend/src/db/client.ts`
- 验证：TypeScript 编译通过

**Task 1.3**：新增 `PublishPackage` 记录 repository
- 文件：`backend/src/modules/publish/publish-record.repository.ts`
- 功能：`savePublishPackageRecord`、`getPublishPackageRecordById`
- 验证：单元测试

**Task 1.4**：后端 API 骨架
- 文件：`backend/src/modules/publish/publish.routes.ts`
- 端点：
  - `POST /api/projects/:projectId/publish/generate`（首版只用上游字段拼基础数据）
  - `PATCH /api/projects/:projectId/publish`（更新标题/描述/标签/封面选择）
- 验证：API 测试（200 / 404 / 409）

### Phase 2：封面候选（不依赖 LLM）

**Task 2.1**：视频关键帧提取
- 文件：`backend/src/modules/publish/cover-candidates.service.ts`
- 功能：从 render 产出的视频文件用 ffmpeg 截图（0s、25%、50%、75% 位置）
- 验证：smoke 测试（fake mp4 → 截图文件存在）

**Task 2.2**：从分镜图收集候选
- 功能：读取 AssetManifest.segment_routes，收集已完成的分镜图 artifact
- 验证：候选列表非空

**Task 2.3**：封面候选合并 + API
- 端点：`POST /api/projects/:projectId/publish/cover/candidates`
- 返回：合并后的封面候选列表
- 验证：API 测试

### Phase 3：标题候选（LLM）

**Task 3.1**：新增 LLM prompt
- 文件：`harness/prompts/publish/title-generator.prompt.md`
- 语言：zh-CN
- 输入：TopicPackage、ScriptDraft 摘要、视频时长
- 输出：3-5 条标题候选，每条带 style 标注
- 验证：prompt-runtime 测试

**Task 3.2**：标题生成服务
- 文件：`backend/src/modules/publish/title-generator.service.ts`
- 功能：构造 prompt input，调用 LLM，解析标题候选
- 验证：stub / mock LLM 测试

**Task 3.3**：标题生成 API
- 端点：`POST /api/projects/:projectId/publish/title/candidates`
- 返回：title_candidates 数组
- 验证：API 测试

### Phase 4：描述生成（LLM）

**Task 4.1**：新增 LLM prompt
- 文件：`harness/prompts/publish/description-generator.prompt.md`
- 语言：zh-CN
- 输入：TopicPackage、ScriptDraft、视频时长
- 输出：一段发布描述
- 验证：prompt-runtime 测试

**Task 4.2**：描述生成服务 + API
- 文件：`backend/src/modules/publish/description-generator.service.ts`
- 集成到 `POST /api/projects/:projectId/publish/generate`
- 验证：API 测试

### Phase 5：前端

**Task 5.1**：新增 publish workspace step
- 修改：`frontend/src/stores/workspace.ts` — PIPELINE_STEPS 新增 `publish`
- 修改：`frontend/src/views/ProjectWorkspace.vue` — 注册 PublishPanel 组件
- 修改：`frontend/src/components/workspace/WorkspaceSidebar.vue` — 侧边栏新增按钮

**Task 5.2**：新增 PublishPanel 组件
- 文件：`frontend/src/components/publish/PublishPanel.vue`
- 功能：
  - 左侧视频预览
  - 封面候选选择（缩略图网格 + 选中高亮）
  - 标题候选列表 + 选择 + 编辑
  - 描述编辑框
  - 话题标签编辑（新增/删除）
  - "生成发布信息"按钮
  - "导出发布包"按钮

**Task 5.3**：新增 publish store
- 文件：`frontend/src/stores/publish.ts`
- 功能：load / generate / update PublishPackage
- 验证：store 测试

### Phase 6：标签派生

**Task 6.1**：标签本地派生服务
- 文件：`backend/src/modules/publish/hashtag-derivation.service.ts`
- 功能：从 TopicPackage.family_label、scope_label、ArtBible.era_style 等字段派生基础标签
- 验证：单元测试

### Phase 7：集成 & 回归

**Task 7.1**：端到端 API 测试
- 创建项目 → 走完完整流水线 → POST publish/generate → 验证 PublishPackage 字段完整
- 验证：API 测试

**Task 7.2**：前端构建 & 手动验收
- `vite build` 通过
- 浏览器手动验收：render 页 → 进入 publish 页 → 生成发布信息 → 编辑 → 导出

---

## 不改动的文件

- topic / script / storyboard / asset planning / assets / compose / render 任何现有服务
- 现有前端 panel 和 store（除 workspace 注册外）
- 现有 shared schema

## 不变更的接口合同

- 不向 TopicPackage 添加字段
- 不改变 RenderJobRecord 结构
- 不改变 AssetManifest 结构

## 验收命令

```powershell
npx vitest run --configLoader runner tests/backend/publish --no-file-parallelism
npx vitest run --configLoader runner tests/frontend/stores/publish.test.ts
npx vitest run --configLoader runner tests/backend/api/publish-api.test.ts
npx vite build --config frontend/vite.config.ts
```
