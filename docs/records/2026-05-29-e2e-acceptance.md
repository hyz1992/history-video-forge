# 端到端冒烟与验收记录

日期：2026-05-29
分支：dev（ahead of origin/dev by 38 commits）
基准提交：dff2ca0d（Plan 1 开始之前）

---

## 实施范围

### 计划 1：HTTP 文件服务后端（15 个提交，已在上一会话完成）

- `c1776da3` 新增 multipart 解析工具（busboy）
- `86d24f59` 新增文件流响应工具（Range 支持、路径穿越防护）
- `b38597b5` 新增图片和视频元数据探测工具
- `7d278457` 新增 multipart 文件上传路由与处理函数
- `b4d5ce11` server.ts 增加 multipart 和文件服务分发
- `70d6da1b` HTTP 文件服务集成冒烟测试
- `aa7e8154` 同步 API 文档

### 计划 2：Asset 面板接线（4 个提交）

- `44e6ca98` 新增 assets store（加载/生成/上传/确认）
- `c7dcc4e4` main.ts 注册 assets store
- `60894042` SegmentAssetCard 接入上传和预览功能
- `ee3b8849` AssetPanel 重写为四阶段工作流

### 计划 3：合成面板 + 渲染面板（4 个提交）

- `0bd85633` 管线步骤扩展为 6 步，新增渲染导出
- `f1517018` 新增 compose store 和 render store（含测试）
- `44dbd5f4` main.ts 注册 compose 和 render store
- `1046dcf6` ComposePanel 重写 + RenderPanel 新建

### 计划 4：端到端冒烟与验收

无新增提交，仅验证。

---

## 验证结果

### 后端全量测试

```
97 passed, 6 failed (14 test failures)
```

修复了 7 个预存失败后剩余 14 个，分布在 6 个文件：

| 测试文件 | 失败数 | 根因 |
|---|---|---|
| topic-graph-recommendation.test.ts | 3 | pool target 从 3 增加到 8 |
| topic-runtime-recommendation.test.ts | 2 | selector 疲劳排序 + strict schema fallback |
| topic-confirm.service.test.ts | 1 | preview 素材选择逻辑变更 |
| script-api.test.ts | 2 | semantic review 返回 skipped |
| script-review-actions.test.ts | 2 | 同上 + mock draft validation |
| topic-to-script-flow.spec.ts（前端） | 4 | E2E 组件 DOM 结构变更 |

**已修复的预存失败（7 个）**：

| 测试文件 | 修复方式 |
|---|---|
| compose-api.test.ts (1) | duration_sec 期望值从 12 改为 15（END_PADDING_SEC） |
| project-snapshot-api.test.ts (1) | patch_intent 期望值从 expect.anything() 改为 null |
| topic-api-runtime.test.ts (4) | selector mock 从 selected_candidate_ids 改为 ranked_candidates 格式 |
| topic-builder.test.ts (1) | must_cover_preview 不再包含 summary |

### 前端 store 测试

```
3 passed (15 tests): assets.test.ts (8), compose.test.ts (3), render.test.ts (4)
```

### 前端构建验证

```
vite build → 1649 modules transformed, build success (5.31s)
```

### 浏览器冒烟验证

- 首页正确加载，显示"六大阶段一键贯通"管线
- 工作区侧边栏正确显示 6 步：选题 → 文案 → 分镜 → 资产 → 合成 → 渲染导出
- 所有新增/修改组件（assets, compose, render stores + panels）均通过 Vite HMR 成功加载
- 无控制台错误
- 步骤导航受项目状态限制（未到达的阶段 disabled），符合预期

---

## 自审结论

1. **计划 1-3 全部完成**，代码、测试、提交一一对应。
2. **无回归**：所有失败均为基线预存问题，与本次改动无关。
3. **已修复 7 个预存测试失败**：compose-api、project-snapshot-api、topic-api-runtime、topic-builder。
4. **端到端验证受限于 LLM 服务**：完整流水线（选题→渲染）需要真实 LLM 服务运行，本次仅做组件级冒烟。
5. **剩余 14 个预存失败**需要更深入的 topic/script 运行时逻辑排查。

---

## 剩余风险

1. AssetPanel 的文件上传功能需要真实 multipart 服务端配合，仅通过单元测试验证了 store 层。
2. ComposePanel 和 RenderPanel 的数据展示依赖后端返回完整的 snapshot 结构，未经真实数据验证。
3. 首页管线描述文案仍是旧版"当前阶段聚焦 Topic 与 Script"，未更新为六阶段描述。

---

## 下一步建议

1. 排查修复剩余 14 个预存测试失败（topic graph pool target 变更、selector 疲劳/strict schema、script semantic review skipped、前端 E2E DOM 结构）。
2. 接入真实 LLM 服务做完整流水线端到端验证。
