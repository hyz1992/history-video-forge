# API 设计（第一版）

本文档定义新项目当前已确认阶段的 API 边界。

目标不是一次把全部 endpoint 设计完，而是先回答：

- topic 阶段前后端如何交互
- script 阶段如何触发与获取结果
- 长时任务如何通知前端

## 1. 设计原则

1. 以 `project` 为顶层资源。
2. 用户显式操作触发 API；内部 patch / regenerate 不单独暴露成用户 API。
3. topic 与 script 的长时任务优先采用异步任务 + SSE 状态流。
4. API 只暴露当前已确认阶段。
5. storyboard / assets / compose 相关 endpoint 暂不承诺。

## 2. 顶层资源

### `POST /api/projects`

用途：
- 创建一个新的视频任务

返回：
- `project_id`
- 初始状态
- 默认 topic 页面所需基础信息

### `GET /api/projects/:projectId`

用途：
- 获取项目当前快照

返回：
- 基础信息
- 当前阶段状态
- active topic package / active script record 摘要

### `GET /api/projects/:projectId/stream`

用途：
- SSE 订阅长时任务状态

典型事件：
- `topic_generation_started`
- `topic_candidates_ready`
- `topic_confirmed`
- `script_generation_started`
- `script_patch_started`
- `script_regen_started`
- `script_ready`
- `pipeline_error`

## 3. Topic 阶段 API

### A. 系统自动推荐

`POST /api/projects/:projectId/topic/recommendations`

用途：
- 根据当前筛选偏好触发系统自动推荐

输入：
- 用户筛选偏好
- 是否允许复用缓存候选

返回：
- 一个异步任务确认
- 候选完成后通过 SSE 或轮询获取结果

### B. 事件库入口

`GET /api/events/library`

用途：
- 浏览 curated 事件库

`GET /api/events/library/:eventId`

用途：
- 获取事件详情

`POST /api/projects/:projectId/topic/library-candidates`

用途：
- 对用户选中的 event 生成 2-3 个 `Topic Candidate Card`

### C. 自定义输入入口

`POST /api/projects/:projectId/topic/custom-recognize`

用途：
- 识别用户输入的事件归属

`POST /api/projects/:projectId/topic/custom-candidates`

用途：
- 在事件识别完成后生成 2-3 个 `Topic Candidate Card`

## 4. Topic 确认 API

### `POST /api/projects/:projectId/topic/candidates/:candidateId/confirm`

用途：
- 把某个候选正式冻结成 `Topic Package`

返回：
- `Topic Package` 摘要
- 新的项目状态（应推进到 `script_ready`）

## 5. Script 阶段 API

### `POST /api/projects/:projectId/script/generate`

用途：
- 从当前 active `Topic Package` 进入 script 阶段

输入：
- 可选：是否允许一次 patch / regenerate

返回：
- 异步任务确认

SSE 后续事件：
- `script_started`
- `script_local_validation_passed`
- `script_patch_started`
- `script_regen_started`
- `script_ready`
- `script_failed`
- `script_returned_to_topic`

### `GET /api/projects/:projectId/script`

用途：
- 获取当前 active script 结果

返回：
- script 摘要
- 当前 review 决议

## 6. 错误与状态处理原则

### 统一错误分类

- `400`：输入不合法
- `404`：资源不存在
- `409`：当前阶段状态不允许此操作
- `422`：结构正确但业务约束不满足
- `500`：内部错误

### 长时任务原则

- API 本身不阻塞等待完整 LLM 结果
- 前端通过 SSE 或状态轮询获取完成事件
- 任何 `return_topic` 都应显式通知前端，而不是静默回退

## 7. 当前不在本轮承诺的 API

- storyboard 阶段 API
- asset planning / assets / compose API
- 管理后台校正 Event Registry 的运营 API
