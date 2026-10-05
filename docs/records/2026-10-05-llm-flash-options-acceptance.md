# LLM Flash 选项与默认配置验收

## 原始要求及逐项结果

用户要求：增加 DeepSeek V4 Flash LLM 选项并默认勾选，同时新增 GLM-5.3-Flash。

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 核心 LLM 可选 DeepSeek V4 Flash | 已修 | 服务端候选声明开放 smart/flash；真实设置页及玄奘项目设置均展示；生产 seed + fixed resolver 回归 |
| 默认勾选并持久化 | 已修 | 本机平台两槽默认均为 Flash；当前用户设置保存、刷新后两槽 checked；SQLite 用户 revision 6，两槽 fixed 指向 Flash |
| 新项目继承默认 | 已修 | 真实 SQLite POST 创建回归：口播资格选择后两槽 fixed Flash 保留，来源 revision 2，用户偏好不被改写 |
| 新增 GLM-5.3-Flash | 已修 | 两槽展示并分别勾选；生产 seed 与 fixed resolver 均返回 zhipu:glm-5.3-flash |
| GLM 请求参数兼容 | 已修 | JSON 与 tool mock HTTP 请求均发送 thinking enabled，interaction log 同值；旧模型 disabled 回归保持通过 |
| 旧数据库默认切换与重启 | 已修 | 真实 SQLite 先种旧 Pro/GLM 默认，再换双 Flash 默认，两次应用通过，每槽恰好一个 active 默认 |
| 远端 GLM 模型实际生成 | 未验证 | 本轮没有付费调用；候选注册、凭据 readiness 和 mock transport 不等于国内智谱 API 实测 |

## 实际改动与默认作用范围

- 两槽提供 DeepSeek V4 Flash、GLM-5.3-Flash，旧选项保留。
- `.env.example` 默认映射及本机忽略的 `.env` 两槽均设为 `deepseek:deepseek-v4-flash`；已有用户明确勾选固定模型，新项目复制偏好。shared 默认仍是 auto，stub 行为保持。
- LLM seed 先写非默认候选，解除旧默认后再写新默认；避免单事务中 SQLite 唯一索引冲突。
- 仅 GLM-5.3-Flash 在 provider 参数合并后适配为开启思考；全局 operation 策略与 prompt 未修改。
- 玄奘项目设置已显示新候选，本轮取消关闭，没有保存项目配置：原项目显式 Pro 及生成历史保留。图片、视频、口播选择未变化。

当前用户保存审计：revision 5→6，仅 `capabilities.llm.smart` 从 GLM-5 改为 DeepSeek V4 Flash，flash 原本即 fixed Flash；视频策略、画质、字幕和媒体能力均无 diff。

## 验证结果

三组测试合计 **13 文件 / 278 项通过**：

```powershell
npx vitest run --configLoader runner tests/backend/config/llm-model-catalog-readiness.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/db/generation-cost-catalog-bootstrap.test.ts
npx vitest run --configLoader runner tests/backend/config/provider-model-catalog.test.ts tests/backend/config/generation-configuration-resolver.test.ts tests/backend/config/generation-config-repository.test.ts tests/backend/api/generation-config-api.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/tier-aware-provider.test.ts tests/frontend/capability-slot-settings-ui.spec.ts tests/frontend/generation-config-store.spec.ts tests/frontend/generation-settings-ui.spec.ts
npx vitest run --configLoader runner tests/backend/narration/narration-project-creation.test.ts
npm run typecheck:backend
npm run build:frontend
git diff --check
```

后端类型检查、前端构建通过。构建提示既有 Rollup 注释与 bundle 体积警告；测试夹具中旧 HTTP 媒体目录 readiness 提示不影响本次 LLM 验收。

红绿证据：候选回归先因 core Flash 缺失失败；GLM JSON/tool 先因发送 disabled 失败；真实默认切换先因 capability 唯一约束失败，最小实现后全部通过。

内置浏览器：全局设置展示、GLM 两槽临时勾选、Flash 两槽保存、刷新 checked；玄奘项目设置展示后取消。截图位于本机 `storage/acceptance-20261005-llm/default-models.png`，不提交生成态文件。只读 SQLite 验证两槽 active 默认均为 Flash，用户两槽 fixed 保存成功。

## 自审结论与剩余风险

代码只读审查通过；未创建分支/worktree，未改用户原有 `.claude/settings.local.json` 或提交 storage 生成态文件。

本轮完成选项、默认与路由配置验收，未评估模型生成的故事或视觉质量。GLM 国内 API 可用性、实测价格和输出质量未验证；未核实价格继续 unpriced。GLM 模型只支持开启思考，不能沿用旧模型关闭思考时的时延预期。

下一步建议：在选题/文案阶段用同一主题做小规模质量对比，通过后再进入付费图像和视频生成。

设计与实施：[设计](../plans/archive/2026-10-05-llm-flash-options-design.md)、[计划](../plans/archive/2026-10-05-llm-flash-options-implementation-plan.md)。
