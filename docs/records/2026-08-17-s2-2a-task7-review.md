# S2-2A 任务 7 审查记录（T2）

日期：2026-08-17

任务：S2-2A 任务 7 —— 建立 provider/model 目录与后端全能力价格服务。

提交：

- `0c75bde` 建立生成能力目录与后端价格服务（初始实现）
- `39c4dc9` 整改任务 7 一轮：授权上界不低于估算、disabled 行不翻转 readiness、catalog 运行时校验与 writer 失败路径测试
- 本记录随第三轮 Minor 整改（free 视频档位零价回退 + 注释修正）一并提交

审查级别：T2（共享配置合同与费用）。按 harness/docs/independent-review-protocol.md 执行：diff_reviewer + contract_reviewer 并行首轮 → 整改 → 双 reviewer 复审收敛 → final_reviewer 终审一次。

验证证据：

- `npx vitest run --configLoader runner tests/backend/config/` → 全部通过（首轮 111，二轮 121，三轮 122）
- `npx tsc -p backend/tsconfig.json --noEmit` → 0 错误
- 根 tsconfig 中与本任务相关文件无类型错误（.vue 解析与 asset-planning store 的报错为存量问题，非本任务引入）

## 有效 finding 与闭环

| Finding（分级） | 闭环方式 |
|---|---|
| I-1/F4 估算可超授权上界（Important，双 reviewer 同源） | 授权改为 max(估算, budget/任务上限)，保证 authorizationCostMicros ≥ estimatedCostMicros；token/video 各一对抗测试（pricing-service.test.ts） |
| I-2 disabled 行翻转 readiness ok（Important） | readiness 不再为 disabled 行发 issue（disabled 是合法目录状态，设计 4.3）；disabled 行仍不可报价；新增测试 |
| I-3/F6 catalog 输入零运行时校验（Important） | 新增 CatalogEntrySchema 结构守卫，畸形条目落 pricing_invalid_workload；新增测试 |
| I-4 repository 先内存后持久化 + writer 路径零测试（Important） | 改为先持久化成功再更新内存，错误传播；新增 writer happy/throw 测试 |
| N1/F1 移交承诺未落盘（Important，流程） | 本记录即为落盘证据；移交项见下节 |
| M1/M3/M4/M5/M6/M7/M8/N3（Minor） | 空 workload 返 "0"；负价拒绝；秒数向上取整；capability mismatch 测试；resolveLlmTierTarget 统一实现；多 item budget 注释声明；M8 自愈已由 reviewer 独立核验；注释修正 |
| M2/F5/N2 free 语义（Minor） | token/image/tts/request 于二轮修复；video_second 于三轮修复（声明档位零价回退，未声明档位仍拒绝），新增测试 |

reviewer 事实错误更正：contract_reviewer 首轮 F2 断言"根 .env 未设置 LLM_SMART_MODEL/LLM_FLASH_MODEL"，经 grep 复核与 reviewer 二轮自查（其检索输出被 head 截断）确认错误；当前环境即 resolved tier 模式。

## 移交项（后续任务必须承接）

以下两项在任务 7 文件范围（不含 server.ts/app.ts）内无法完成，且实施计划任务 8 的现有步骤（quote/幂等/事务/dispatcher/路由注册）未显式承接。**归属需要用户裁决**（归入任务 8 增补步骤，或单独微任务）：

1. **启动期 catalog seed 应用与 readiness 交叉校验接线**：`applyProviderModelCatalogSeed`、`buildPricingCatalogSeed`（tier 快照从 env 推导）、`evaluateGenerationCapabilityReadiness` 目前无任何生产调用点。未接线期间，生产 DB 仍是任务 2 迁移的占位目录行，`GET /api/generation-capabilities` 继续服务占位数据。接线时需同时决策 readiness 失败的启动处置策略（阻断/降级/仅告警）——设计 4.3 未定义，禁止实施者自行发明。
2. **legacy env → seed 的 tier 映射语义**：`LlmTierSeedInput` 的 resolved 模式可表达 legacy 回退（providerKey="default" + flash reusesSmart），但 env → seed 输入的推导逻辑（含 `resolveTierProviderSnapshot` 对 legacy 的处理与失败路径到 resolution_failed 的映射）属接线范畴，随上一项一并设计与测试。

## 用户知情裁决项（不阻塞任务 7 关闭）

- **真实 LLM 价格核实**：`VERIFIED_LLM_TOKEN_PRICING` 为空表，当前 smart（deepseek:deepseek-v4-pro）/flash（zhipu:glm-4）条目 unpriced → 全部 LLM 报价 unbounded，需显式授权。运营核实公开价后登记即可获得可信上界。建议在任务 8 报价链路上线前裁决。

## 未验证项

- 真实付费 provider 调用（按边界不触发；live check 需用户显式授权）。
- Prisma 激活态下 `saveProviderModelCatalogEntry` 的真实落库集成行为（沿用任务 2/6 的测试基础设施状态，内存态 + writer 接口测试覆盖）。
