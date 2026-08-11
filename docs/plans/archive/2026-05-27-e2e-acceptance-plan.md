# 端到端冒烟与验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计文档 Testing Strategy 中的验收标准逐一验证，修复发现的问题，确保全链路从前端空项目到成品下载可完整走通。

**Architecture:** 以前端 + 后端联合运行的方式，逐步执行设计文档中的验收标准。每项标准独立验证，发现问题就地修复。验收标准来源：`docs/plans/2026-05-26-frontend-workflow-design.md` 的 Testing Strategy 章节。

**Tech Stack:** Vitest（后端测试），浏览器手动验证（前端全链路）

**设计文档：** `docs/plans/2026-05-26-frontend-workflow-design.md`

**前置依赖：** 实施计划 1、2、3 全部完成

---

## 验证环境准备

### 服务端口

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:5173`（Vite 默认）

### 测试素材

准备以下 fixture 文件用于上传验证：

| 文件 | 格式 | 用途 | 建议来源 |
|------|------|------|----------|
| `test-image.png` | PNG, ~50KB | 图片上传测试 | 构造最小合法 PNG（1x1 像素）或使用 image-size 库的 fixture |
| `test-video.mp4` | MP4, <5MB | 视频上传测试（需要 ffprobe 可用） | 如果 ffprobe 不可用，跳过视频上传测试 |

建议将 fixture 放在 `tests/fixtures/` 目录。

### 上传范围说明

半自动生成（传 `enabled_provider_types: ["tts", "sfx", "bgm"]`）会让所有 `image_still` 和 `video_clip` 任务进入 `waiting_manual_upload` 状态。**必须为每个 waiting 的视觉任务都上传文件**，manifest 才能达到 `ready_for_compose`。

具体来说：
- 如果项目有 N 个分段，每个分段有 1 个 `image_still` 任务，则需要上传 N 张图片
- 如果还有 `video_clip` 任务，也需要逐一上传视频（或使用全量自动生成跳过手动上传）
- 如果不希望逐一上传，可选择"全部自动生成"路径

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

- [ ] 前端从空项目走通全链路（两种路径选一，见下文）
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

- [ ] **Step 2: 在浏览器中执行全链路验证（路径 A：半自动）**

1. 访问首页 `http://127.0.0.1:5173`，创建新项目
2. 走完选题 → 文案 → 分镜步骤（这些步骤已冻结，不应有问题）
3. 在资产步骤，点击"生成资产规划"
4. 资产规划生成完成后，点击"生成资产（手动上传图片/视频）"
5. 等待自动资产生成完成（TTS/音效/BGM）
6. **逐个找到所有 `waiting_manual_upload` 状态的视觉任务，每个都上传对应的图片**
   - 切换到图片 tab，点击上传按钮
   - 选择准备好的 fixture 图片
   - 等待上传完成，确认预览显示
   - 对所有分段的视觉任务重复此步骤
7. 确认所有资产就绪（manifest readiness 变为 `ready_for_compose`）后，点击"确认并进入合成"
8. 在合成步骤，点击"生成合成时间线"
9. 等待合成完成，验证结果条显示 `ready_for_render`
10. 点击"进入渲染"
11. 在渲染步骤，点击"开始渲染"
12. 等待渲染完成，验证视频播放器显示成品
13. 点击"下载视频"，验证下载成功
14. 点击侧边栏"渲染导出"步骤，确认直接进入渲染面板

- [ ] **Step 3: 在浏览器中执行全链路验证（路径 B：全量自动）**

如果路径 A 卡在手动上传环节，可以改用路径 B 验证：

1. 走完选题 → 文案 → 分镜 → 资产规划（同上 1-3）
2. 点击"全部自动生成"（不传 `enabled_provider_types`）
3. 等待所有资产生成完成
4. 直接进入合成 → 渲染 → 下载（同上 7-14）

- [ ] **Step 4: 记录发现的问题，逐一修复**

### Task 4: 回归验证

- [ ] **Step 1: 全量测试运行**

```bash
npx vitest run --configLoader runner tests/ --no-file-parallelism
```

- [ ] **Step 2: 提交最终修复**

---

## 验收结果记录模板

完成所有 Task 后，将结果记录到 `docs/records/YYYY-MM-DD-e2e-acceptance.md`，使用以下模板：

```markdown
# 端到端验收记录

Date: YYYY-MM-DD

## 环境
- 后端版本: <git commit hash>
- 前端版本: <git commit hash>
- 测试项目: <project ID>
- 服务端口: 后端 3000 / 前端 5173

## 验收标准

| # | 标准 | 结果 | 备注 |
|---|------|------|------|
| 1 | 全链路走通（路径 A 半自动） | PASS/FAIL | |
| 2 | 全链路走通（路径 B 全量） | PASS/FAIL | |
| 3 | 上传后 segment_routes 更新 | PASS/FAIL | |
| 4 | render preview 返回 inline | PASS/FAIL | |
| 5 | render download 返回 attachment | PASS/FAIL | |
| 6 | 重复 generate 确认提示 | PASS/FAIL | |

## 发现的问题

1. <问题描述>
   - 修复: <commit hash>

## 修复提交

- <commit hash>: <描述>
```
