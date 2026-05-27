# 端到端冒烟与验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计文档 Testing Strategy 中的验收标准逐一验证，修复发现的问题，确保全链路从前端空项目到成品下载可完整走通。

**Architecture:** 以前端 + 后端联合运行的方式，逐步执行设计文档中的验收标准。每项标准独立验证，发现问题就地修复。验收标准来源：`docs/plans/2026-05-26-frontend-workflow-design.md` 的 Testing Strategy 章节。

**Tech Stack:** Vitest（后端测试），浏览器手动验证（前端全链路）

**设计文档：** `docs/plans/2026-05-26-frontend-workflow-design.md`

**前置依赖：** 实施计划 1、2、3 全部完成

---

## 验收标准清单

以下标准来自设计文档 Testing Strategy 章节：

### 后端单元测试（必须通过）

- [ ] multipart 上传：合法文件成功注册并探测元数据
- [ ] multipart 上传：超 10MB 拒绝
- [ ] multipart 上传：MIME 不在允许列表拒绝
- [ ] multipart 上传：魔数不匹配拒绝
- [ ] multipart 上传：原始文件名被忽略（服务端生成文件名）
- [ ] multipart 上传：task 不允许手动上传时拒绝
- [ ] multipart 上传：视频上传后元数据不全时拒绝
- [ ] 文件服务：合法 artifact 返回正确 Content-Type
- [ ] 文件服务：路径穿越返回 403
- [ ] 文件服务：不存在的 artifact 返回 404
- [ ] 文件服务：Range 请求正确响应 206
- [ ] render preview：返回 `Content-Disposition: inline` + `Content-Type: video/mp4`
- [ ] render download：返回 `Content-Disposition: attachment` + 正确文件名
- [ ] `enabled_provider_types`：传 `["tts", "sfx", "bgm"]` 时 image/video 任务状态为 `waiting_manual_upload`
- [ ] artifact 覆盖：重复上传同一任务，新 artifact ID 在 `output_artifact_ids` 首位，旧 ID 保留在列表中

### 前端 store 单元测试（必须通过）

- [ ] API 调用参数正确（URL、method、body）
- [ ] 状态变更：loading → success / error
- [ ] uploadArtifact 构造 FormData
- [ ] artifactFileUrl 拼接正确的 preview URL

### 端到端冒烟（验收标准）

- [ ] 前端从空项目走通全链路：生成计划 → 生成资产（传 `["tts", "sfx", "bgm"]`） → 上传图片 → compose → render → 下载成品
- [ ] 上传图片后 `segment_routes.primary_visual_artifact_id` 指向新 artifact
- [ ] render preview 返回 `video/mp4` + inline，download 返回 attachment
- [ ] 重复 generate 前端弹出确认提示

---

## Task 列表

### Task 1: 运行全部后端测试

- [ ] **Step 1: 运行已有后端测试，确认全部通过**

```bash
npx vitest run --configLoader runner tests/backend/ --no-file-parallelism
```

如果测试失败，逐一修复直到全部通过。

- [ ] **Step 2: 提交修复（如有）**

### Task 2: 运行全部前端 store 测试

- [ ] **Step 1: 运行前端 store 测试**

```bash
npx vitest run --configLoader runner tests/frontend/stores/
```

如果测试失败，逐一修复直到全部通过。

- [ ] **Step 2: 提交修复（如有）**

### Task 3: 端到端全链路验证

- [ ] **Step 1: 启动后端和前端开发服务器**

```bash
npm run dev:backend
npm run dev:frontend
```

- [ ] **Step 2: 在浏览器中执行全链路验证**

1. 访问首页，创建新项目
2. 走完选题 → 文案 → 分镜步骤（这些步骤已冻结，不应有问题）
3. 在资产步骤，点击"生成资产规划"
4. 资产规划生成完成后，点击"生成资产（手动上传图片/视频）"
5. 等待自动资产生成完成（TTS/音效/BGM）
6. 找到一个 image_still 任务，点击"上传"按钮，选择一张图片
7. 验证上传成功后图片预览显示
8. 确认所有资产就绪后，点击"确认并进入合成"
9. 在合成步骤，点击"生成合成时间线"
10. 等待合成完成，验证结果条显示 ready_for_render
11. 点击"进入渲染"
12. 在渲染步骤，点击"开始渲染"
13. 等待渲染完成，验证视频播放器显示成品
14. 点击"下载视频"，验证下载成功
15. 点击侧边栏"渲染导出"步骤，确认直接进入渲染面板

- [ ] **Step 3: 记录发现的问题，逐一修复**

### Task 4: 回归验证

- [ ] **Step 1: 全量测试运行**

```bash
npx vitest run --configLoader runner tests/ --no-file-parallelism
```

- [ ] **Step 2: 提交最终修复**

---

## 验收结果记录

完成所有 Task 后，将结果记录到 `docs/records/` 中。
