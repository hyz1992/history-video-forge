# 角色规划语义回修与容量对照验收记录

## 结论与范围

2026-10-03，沿用用户继续整改和新增最多 50 元的授权，完成两个正式 prompt 回修以及两次有界 global 实测。8192 上限请求被截断；16384 容量对照完整返回，但人工语义和参考相容检查未通过。**年龄阶段改善，整体不能签收。** 两个目标分块和两张图片均取消，分段 prompt v1.5.0 的真实输出及新两镜画面仍为未验证。

验收范围来自用户的内置浏览器角色一致性请求及此前发现的衣冠、动作、额外帝王和参考身份风险，不以 prompt 合同测试或探针审查的 Approved 代替实际验收。旧[七次规划结果](./2026-10-03-character-scene-planning-live-check.md)及[九图结果](./2026-10-03-character-sheet-full-body-acceptance.md)全部保留。

## 实际修改与离线验证

- `ede1a65c`：全局 planner 升 v1.5.0，先按脚本主叙事时点确定年龄阶段，无法确认时用宽年龄阶段、不猜具体数字。仅正式 prompt、中文 changelog 和合同测试三文件。
- `acb66832`：segment planner 升 v1.5.0，拆开可见衣冠器物形状、连续动作瞬间、多人位置职责规则，保留原分镜与史实边界。仅上述对应三文件。
- 两任务分别红 1 failed / 2 passed → 134/134；父独立复跑 134/134，prompt 治理通过（23 prompts、12 fixtures、无新增 active drift）。规格后质量审查均 Approved，零 Critical / Important / Minor。测试只证明规则合同，不证明生成质量。
- `8deab254`：记录 8192 截断，批准一次独立的有限容量对照。未改正式生成入口的容量、业务 TS、schema、模型、上游内容或优化器。

相关最小验证命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/harness/assets-character-sheet-smoke.test.ts
npm run harness:check-prompts
```

## 两次真实调用与停止边界

两个本地未跟踪探针均使用现有 `generateAssetPlan`、registry/gateway、真实 global 输入 builder、正式解析和画风合并。来源仍是同一 18 段、脚本、confirmed narration、原双快照路线、720P 与人工冻结画风；数据库始终 readonly，不激活输出、不调用媒体供应商。

源、预检、输入、旧费用与不可覆盖证据在发出前校验。smart 模型均为 `deepseek-v4-pro`，每次最多一次供应商尝试、120000 ms、完整系统和输入合计 46190 UTF-8 bytes。容量对照仅提高探针输出上限，其余输入、正式 prompt 和模型不变；规格后质量审查 Approved。此上限不是生产入口的硬编码设置。

| 批次 | 输出上限 | 实际次数 | token（输入／输出／其中 reasoning） | 回执及验收结果 | 保守费用（元） |
| --- | --- | --- | --- | --- | --- |
| `scene-planner-repair` | 8192 | 1 | 12450／8191／6678 | `finishReason=length`，JSON 字符串未结束，解析失败；立即停止，取消剩余两次。没有全局快照或批准 | 0.333207 |
| `scene-planner-capacity` | 16384 | 1 | 12450／6172／2671 | `finishReason=stop`，正式解析及画风合并后到达首个 segment builder；暂停人工检查。结构边界通过，语义未通过 | 0.278694 |

HTTP 回执成功不等于 JSON 或语义成功。没有补齐截断 JSON、结构修复调用、第四次请求或自动扩容重试；不从截断输出提取“通过”的身份。完整 global 也不是完整计划 pass，本阶段没有产出可验收的全片计划。

## 原始验收项与人工审读

父任务阅读完整新 global，并查看 H2/E2 完整源图；独立审查同样实际查看两图，与父结论一致。新稳定身份仍不适合冻结旧参考继续两目标调用。

| 验收项 | 状态 | 实际证据及边界 |
| --- | --- | --- |
| 完整新 global 的年龄阶段 | 已修 | 李世民为“青年”，李渊为“老年”，与旧约二十八／六十岁参考阶段相容。只批准年龄阶段，不声称精确年龄或全体角色史实已核验 |
| 稳定身体特征与造型分工（A14） | 部分修 | 冠服、甲胄、武器存于 `visual_description`，但 identity 混入“沉静神态”“姿态端方”“神态疲惫”“臂力过人”“行动剽悍”；字段结构合格，语义边界未完全遵守 |
| 李世民与 H2 相容（A14） | 部分修 | 直鼻、硬朗下颌和健壮肩背大体相符；H2 脸型向下收窄，新“方阔面型”更强，旧固定短髭须未保留。不能当作完整相容 |
| 李渊与 E2 相容（A14） | 未修 | 新 identity 固定“中等偏胖”，旧冻结身份是“中等体型”；E2 腰身较直，脸颊无明显饱满感，存在具体体型冲突 |
| v1.5.0 两目标衣冠细节（A11） | 未验证 | 前置检查未通过，chunk_002／chunk_006 均取消；合同规则通过不能替代真实输出。旧 v1.4.0 衣冠抽象失败仍保留 |
| v1.5.0 动作与人数职责（A13） | 未验证 | 同上。旧 D2 额外黄袍人物、登御座动作失败与旧 planner 改写动作未被新画面修复 |
| 新两镜图片、全片及统计稳定性 | 未验证 | 新媒体调用 0、未激活新 QA 计划；没有本次图片效果可签收 |

内置浏览器复看现有第 16 镜 D2 第七版本，仍为戴冕冠的李世民站在御座前、李渊在侧，御座另有黄袍人物。截图 `storage/acceptance-20261003/scene-planner-capacity-existing-D2-browser.png` 保存实际页面及预览信息；**它是旧 D2 的当前 UI 证据，不是本次新 global 的出图**。未点生图确认、未改旧版本。

## 累计预算与保护验证

继续同一个 50 元基线，不重设预算或删除失败调用。按已核验的[DeepSeek 官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)采用更保守的高峰输入缓存未命中 9 元／百万 token、输出 27 元／百万 token；reasoning 已包含于输出，不重复叠加。本地 LLM 探针不写项目 UsageCostRecord，须单独合并图片系统账本。

| 来源 | 实际次数 | 保守估算（元） |
| --- | --- | --- |
| 原九图 | 9 张 | 1.800000 |
| 原完整规划 | 7 次 LLM | 1.555362 |
| 8192 截断 | 1 次 LLM | 0.333207 |
| 16384 完整 global | 1 次 LLM | 0.278694 |
| 累计 | 9 张图片＋9 次 LLM，视频 0 | **3.967263** |
| 原授权估算剩余 | — | **46.032737** |

供应商实际账单未核验；累计及剩余都是预算管理估算，不能称为已扣费。原 0.40／0.60 元两笔历史授权不重复计入此次基线。未执行调用的预留不视为支出，也没有因剩余预算继续重试。

父任务零付费关闭检查 exit 0：逐次 settled 费用合计一致，QA 数据库相对原基线仍仅九个新媒体 job、九条 usage，全部 completed、一次尝试；capacity 没有 global-approval、targets-started、call-02／03-scheduled。新不可覆盖人工检查记录显式 `approvedForTargetCalls=false`、`h2e2IdentityCompatible=false`，两次目标 LLM 和两张图取消。所有已有 AssetPlanRecord／AssetManifestRecord 正文哈希与预检相同；生产数据库未修改。

## 本地证据与后续建议

目录 `storage/acceptance-20261003/`：

- `scene-planner-repair-`：input、preview、preflight、summary、global-started／events／summary、call-01-scheduled／interaction／settled；全部失败证据保留。
- `scene-planner-capacity-`：同类预检、调度、回执与结算，另有 global-snapshot、global-manual-review；后者绑定快照、回执、H2/E2 和浏览器截图哈希及累计账本。
- 两个探针和零付费 `scene-planner-capacity-close.mjs` 保留本地；不提交生成态、数据库、原始供应商记录或密钥。

本有限批次结束，结构与年龄阶段通过，参考相容及完整身份语义未通过；分段新规则只通过离线合同。先明确新规划和定妆图的配套版本：新方案若采用不同体型，应使用该方案自己的参考，不能直接拼接旧参考；如产品要求保留既有角色外貌，需另外设计复用冻结身份的输入合同。两者均不在本次通过范围，不能手改输出或新增本地语义关键词门禁解决。后续应单独制定小批，先验证身份边界，再验证衣冠、原动作和人物职责，不直接进入全片生成。

文档最终规格审查后质量审查均 Approved，Critical／Important／Minor 为 0；独立重算费用、验证关闭记录哈希及 readonly 数据库保护，并实际查看浏览器截图，结果一致。文档审查通过不改变上述语义未通过结论。
