# S2-2A 任务 7 审查记录（T2）

日期：2026-08-17（首轮）／2026-08-18（重开整改、二次重开收口、三次重开收口）

任务：S2-2A 任务 7 —— 建立 provider/model 目录与后端全能力价格服务。

提交：

- `0c75bde` 建立生成能力目录与后端价格服务（初始实现）
- `39c4dc9` 整改任务 7 一轮：授权上界不低于估算、disabled 行不翻转 readiness、catalog 运行时校验与 writer 失败路径测试
- `df30c62` 整改任务 7 二轮：free 视频档位零价回退并落盘 T2 审查记录与移交项
- `1809111` 勾选计划任务 7 完成复选框
- `f959c91` 重开整改（用户外部校准审计后）：启动接线目录 seed 与 readiness、媒体模型精确交叉校验、安全整数防护与事务批量 seed
- `2821b0f` 补跨环境恢复测试并更新任务 7 审查记录闭合移交项
- `4e836da` 修正任务 7 审查记录重开轮测试计数
- `b85dc5f` 二次重开整改（codex 第二轮）：真实派发过目录闸门、部署区域进定价与 readiness、事务测试绑定修正与 LLM 原因码
- `b9a3ff1` 二次重开收口：区域精确主机解析、派发闸门区域纵深防护与 Prisma 区域链路测试
- `53188b0` 三次重开收口（codex 第三轮）：派发闸门优先匹配当前区域 active 行、区域解析强制 https 与标准端口

审查级别：T2（共享配置合同与费用）。按 harness/docs/independent-review-protocol.md 执行：diff_reviewer + contract_reviewer 并行首轮 → 整改 → 双 reviewer 复审收敛 → final_reviewer 终审一次。

验证证据：

- `npx vitest run --configLoader runner tests/backend/config/` → 全部通过（首轮 111，二轮 121，三轮 122；重开整改后 135；二次重开后 140）
- 二次重开轮（2026-08-18）：config 140 / api 130 / db 125（串行）/ assets 258（串行，含 dispatch gate 7 用例）；backend tsc 0 错误；build:backend 通过
- 三次重开轮（2026-08-18）：assets 260（串行，含 dispatch gate 9 用例）/ config 140 / api 130 / db bootstrap 4；backend tsc 0 错误；build:backend 通过
- `npx tsc -p backend/tsconfig.json --noEmit` → 0 错误
- 重开整改追加：`tests/backend/db/`（串行）26 文件 124 通过；`tests/backend/assets/`（串行）40 文件 251 通过；`npm run build:backend` 通过
- 根 tsconfig 中与本任务相关文件无类型错误（.vue 解析与 asset-planning store 等报错为存量问题，基线 394 个，非本任务引入）

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

## 移交项状态更新（2026-08-18 重开整改后）

原移交项 1/2（下节保留原文备查）已由 `f959c91` **闭合**：

1. ~~启动期 catalog seed 应用与 readiness 交叉校验接线~~ → `backend/src/server.ts` 在 Prisma hydrate 后调用 `bootstrapGenerationCostCatalog`（`backend/src/modules/generation-cost/generation-cost-bootstrap.ts`）：真实 tier（stub/resolved/resolution_failed 含 legacy 回退映射）、媒体支持矩阵（`readDashscopeConfig`，env 覆盖后的真实执行模型）、凭据与环境全部进入 seed 与 readiness；不可报价项物化为目录 disabled，目录 API（只返回 active）与报价边界（pricing service 拒绝非 active）消费同一状态。真实 Prisma 启动集成测试：`tests/backend/db/generation-cost-catalog-bootstrap.test.ts`。
2. ~~legacy env → seed 的 tier 映射语义~~ → `resolveGenerationCostBootstrapInput`：legacy 单 provider 回退由 tier resolver 解析为 provider="default"+legacy model，flash 未配置映射 reusesSmart；tier 解析失败映射 resolution_failed（seed 无 LLM 行，readiness 报缺默认项，fail-safe）。

**启动处置策略补记**（设计 4.3 未定义，本次经用户重开指令授权后由实现固化，终审记录在案）：seed 持久化失败向上传播 = 启动失败（fail-closed，与迁移/hydrate 失败同等对待）；readiness 未完全通过不阻断启动（demo/test 环境必然存在视频禁派发约束，属正常运行状态），结果物化为目录 disabled + 公开原因码告警。物化是环境态：下次启动 seed 按当前环境重新 upsert，环境恢复后自动纠正（有跨环境恢复测试）。

## 原移交项（2026-08-17 首轮记录，已被上述更新闭合）

以下两项在任务 7 文件范围（不含 server.ts/app.ts）内无法完成，且实施计划任务 8 的现有步骤（quote/幂等/事务/dispatcher/路由注册）未显式承接。**归属需要用户裁决**（归入任务 8 增补步骤，或单独微任务）：

1. **启动期 catalog seed 应用与 readiness 交叉校验接线**：`applyProviderModelCatalogSeed`、`buildPricingCatalogSeed`（tier 快照从 env 推导）、`evaluateGenerationCapabilityReadiness` 目前无任何生产调用点。未接线期间，生产 DB 仍是任务 2 迁移的占位目录行，`GET /api/generation-capabilities` 继续服务占位数据。接线时需同时决策 readiness 失败的启动处置策略（阻断/降级/仅告警）——设计 4.3 未定义，禁止实施者自行发明。
2. **legacy env → seed 的 tier 映射语义**：`LlmTierSeedInput` 的 resolved 模式可表达 legacy 回退（providerKey="default" + flash reusesSmart），但 env → seed 输入的推导逻辑（含 `resolveTierProviderSnapshot` 对 legacy 的处理与失败路径到 resolution_failed 的映射）属接线范畴，随上一项一并设计与测试。

## 用户知情裁决项（不阻塞任务 7 关闭）

- **真实 LLM 价格核实**：`VERIFIED_LLM_TOKEN_PRICING` 为空表，当前 smart（deepseek:deepseek-v4-pro）/flash（zhipu:glm-4）条目 unpriced → 全部 LLM 报价 unbounded，需显式授权。运营核实公开价后登记即可获得可信上界。建议在任务 8 报价链路上线前裁决。（媒体价格已由外部审计核实与阿里云官方页一致：wan2.7-i2v 720P ¥0.6/秒、1080P ¥1/秒、qwen3-tts-instruct-flash ¥0.8/万字符。）

## 二次重开整改轮 reviewer 结论摘要（2026-08-18，codex 第二轮审计后）

- codex 第二轮 finding：P1-A（派发绕过 catalog gate）、P1-B（区域未进定价/readiness）、P3-A（事务测试 this 解绑假阳性）、P3-B（resolution_failed 丢失原因码）。
- diff_reviewer 与 contract_reviewer 均判定四项全部闭合、无 Critical/Important 新问题；闭合成因：
  - P1-A：`provider-dispatch-gate.ts` 纯函数 gate（missing/disabled/mismatch/scope_mismatch 四态），`buildProviderRegistry` 三真实 adapter 逐个过 gate（未通过不注册，执行引擎 no-adapter 路径不 fetch/不建 job）；三个生成入口（全量/单任务直接经 `runAssetsGeneration`；upgrade-video 只创建 video_clip 任务，实际派发经后续单任务生成进入同一 gate 边界）；codex 反例"空 catalog+凭据仍调用视频"转正测试。
  - P1-B：`resolveDashscopeDeploymentScope`（精确主机匹配）→ 区域进目录 id/pricingVersion/pricingJson/readiness；新加坡视频价 749420/1124130 微元每秒（codex 核实值），未核实的新加坡 image/tts unpriced→unbounded；unknown 区域不种媒体行且 capability 级 `media_deployment_scope_unknown`。
  - P3-A：回滚测试经 writer 实例调用并断言 DB CHECK 约束错误（非 this undefined）。
  - P3-B：capability 级 `llm_provider_unavailable` / `media_deployment_scope_unknown` 在无条目时也可达。
- 二次收口（b9a3ff1）：区域解析改 URL hostname 精确匹配（防含 aliyuncs 子串的私有域名误判）；gate 增 `deploymentScope` 纵深对照（catalog_entry_scope_mismatch）；补 Prisma unknown 区域重启链路测试与区域派生测试；存量 dashscope 测试 baseUrl 对齐真实域名。
- **已知边界留档（不阻塞任务 7 关闭）**：`local-subtitle-provider` 在 API key 存在时经 `transcribeAudioFile` 发起真实 DashScope ASR 付费调用，该调用不在 gate 范围内（ASR 不属于任务 1 冻结的五个 capability slot 合同；codex 四项未点名）。后续若将 ASR 纳入付费治理，需先扩展 capability 合同。

## 三次重开整改轮 reviewer 结论摘要（2026-08-18，codex 第三轮审计后）

- codex 第三轮 finding：I-1（gate 遇旧区域 disabled 行抢先拒绝当前 active 行）、I-2（区域解析允许 http/ftp/非标准端口携带 Bearer key 派发）、Minor（记录 gate 测试数与 upgrade-video 描述）。
- diff_reviewer 与 contract_reviewer 均判定三项全部闭合、无 Critical/Important 新问题：
  - I-1：`checkProviderDispatchGate` 改为全量扫描候选行，优先返回 active + scope 精确匹配行；兜底顺序 scope_mismatch → disabled → mismatch → missing；Map 顺序无关；对抗测试覆盖"北京 disabled 先插入 + 新加坡 active → 放行"与"仅旧区 disabled → 拒绝"。
  - I-2：`resolveDashscopeDeploymentScope` 要求 https: 协议、空端口或 443、官方精确 hostname，否则 unknown fail-closed；对抗测试覆盖 http/ftp/8443/8080/私有域名/无法解析。
  - Minor：记录修正为 7 用例并准确描述 upgrade-video（只建任务，派发经单任务生成进入 gate）。
- 观察留档（非必改）：URL 带 userinfo 仍解析为已知区域（连接仍是 https 官方主机，Bearer 不落明文，不违反 I-2 字面要求），可选后续加固。

## 未验证项

- 真实付费 provider 调用（按边界不触发；live check 需用户显式授权）。
- ~~Prisma 激活态下 seed 真实落库~~ → 重开整改后已由 `tests/backend/db/generation-cost-catalog-bootstrap.test.ts` 覆盖（真实迁移 + Prisma client + DB 行断言 + 事务回滚）。
- `startServer` 全进程启动时序无自动化测试（bootstrap 函数级已有 Prisma 集成覆盖；时序证据为 server.ts 代码位置 + tsc/build；补进程级启动冒烟属测试基建补强，建议随任务 8 顺带）。

## 重开整改轮 reviewer 结论摘要（2026-08-18）

- diff_reviewer：codex P1-1/P1-2/P1-3/P3 全部已闭合，无 Critical/Important 新问题；5 项 Minor（server 接线进程级测试缺失、跨环境恢复测试缺失[已补]、启动重写 updatedAt 噪音、凭据全局布尔近似[当前单 provider 等价]、env 覆盖模型→capability 不可报价[fail-closed 功能限制]）。
- contract_reviewer：codex 验收基准 1-4 已闭合、基准 5（原部分修/未验证项）全部转已修/已验证、基准 6（任务 8+ 越界）未发现越界；4 项 Minor（审查记录滞后[本轮已更新]、单布尔凭据近似、启动处置策略未回写设计文档[已补记于本记录]、物化后 capability 零 active 默认项的次生状态[留档]）。
- 物化次生状态留档：demo/test/unconfigured 下视频 capability 物化后为 0 个 active 默认项；对物化后目录重跑 readiness 会得到 catalog_missing_active_default（当前无此调用点，readiness 仅启动时执行一次）。
