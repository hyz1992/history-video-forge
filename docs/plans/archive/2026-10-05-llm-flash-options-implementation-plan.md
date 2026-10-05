# LLM Flash 选项与默认配置实施计划

目标：增加两槽 Flash 选项，默认使用 DeepSeek V4 Flash，并验证持久化与解析。

架构：候选目录负责可选模型，tier 映射负责平台 auto 默认，用户偏好负责显式勾选及新项目继承。保持当前 schema、路由与前端组件。

技术栈：TypeScript、Vitest、Vue、SQLite、内置浏览器。

## 单任务：目录扩展与默认配置

文件范围：

- `backend/src/modules/generation-cost/llm-model-catalog.ts`：Flash 扩展到两槽，新增智谱候选。
- `backend/src/modules/generation-cost/pricing-catalog.seed.ts`：同步槽位说明；非默认先写、默认后写，兼容旧数据库默认切换。
- `.env.example`：两槽推荐默认映射；本机忽略的 `.env` 同步部署值。
- `tests/backend/config/llm-model-catalog-readiness.test.ts`：生产 seed 与解析回归、旧断言按明确模型定位。
- `backend/src/runtime/llm/openai-compatible-provider.ts` 与 `tests/backend/runtime/provider-hardening.test.ts`：仅 GLM-5.3-Flash 的 thinking 能力兼容，覆盖普通与严格调用和日志真实值。
- `tests/backend/db/generation-cost-catalog-bootstrap.test.ts`：真实 SQLite 默认升级及重复启动。
- `tests/backend/narration/narration-project-creation.test.ts`：真实新项目创建保留两槽 fixed 默认。
- 本设计、计划及中文验收记录：记录边界和证据。

- [x] 补充失败回归：core Flash、两槽 GLM、默认唯一与 fixed/auto 解析；运行 `npx vitest run --configLoader runner tests/backend/config/llm-model-catalog-readiness.test.ts`，确认因候选缺失失败。
- [x] 最小修改候选列表及环境示例，不增加前端硬编码或迁移旧项目。
- [x] 完成目录最小验证后，补 GLM 思考参数兼容及真实默认升级失败测试，再做 helper 与 seed 排序改动；全局 operation policy 不改。
- [x] 运行 catalog/readiness、resolver、bootstrap、用户偏好继承和前端设置相关测试；运行后端类型检查和前端构建。
- [x] 原项目服务已停止，本机无项目 Node 进程；只更新两个 tier 映射并启动后端与前端。页面确认生成中 0。
- [x] 内置浏览器验证两槽选项、用户默认保存与刷新；真实数据库验证默认唯一、用户 revision 6，审计 diff 仅 LLM 选择变化。
- [x] 按用户三个要求写验收记录，自审后精确 stage 并中文提交；不提交本机密钥、生成态数据或用户原有改动。

执行约束：用户已明确授权该改动，直接在 dev 主工作区执行；文档审查采用只读子代理，单任务顺序实现，不创建分支或 worktree。
