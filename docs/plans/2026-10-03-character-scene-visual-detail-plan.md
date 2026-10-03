# 角色一致性场景视觉细节设计与实施计划

## 问题、目标与方案

用户原始目标是内置浏览器验收角色一致性，并已授权继续整改，新增总预算最多 50 元。全身构图小批共九次、估算 1.80 元：四张全身参考通过；原衮冕镜 C 和通用参考规则 R1 均未生成冕冠；仅把“衮冕”展开为可见形状后 D1/D2 都出现冕板、珠旒和礼服。但 D2 御座新增黄袍人，登御座动作也未满足，不能验收整镜。

选择让正式分段规划 LLM 在既有视觉表达规则中补足可见衣冠结构和角色空间关系。保持“当前分镜决定造型、参考只负责身份”的职责，不在业务代码硬编码唐代衮冕、不加关键词语义检查、不新增阶段或重试，也不把失败的 R1 规则编译进请求。只修一个入口后验证；优化器暂不变。

规划规则的最小修改：合并到现有“视觉文字遵守 art_bible”一条中，要求关键衣冠器物除名称外描述辨识形状、结构和颜色；多人镜明确各角色的位置、动作与核心物件关系，不因空位补出新的关键人物。不固化本例衣冠，不新增史实。新 prompt v1.4.0、中文 changelog。自动输出和真实出图仍需分别验收。

## 任务 1：正式分段规划提示词

改动仅三文件：

- `prompts/asset-planning/segment-intent-planner.prompt.md`
- `prompts/asset-planning/segment-intent-planner.changes.md`
- `tests/backend/asset-planning/character-identity-prompt-contract.test.ts`

使用 subagent-driven-development，直接 dev，先合同测试红，再修改已有规则。更新现有测试的版本和规则断言；测试只证明合同存在，不冒充 LLM 质量测量。运行该测试、compiler、generation 和角色 sheet harness（runner、串行），以及 `npm run harness:check-prompts`。规格审查后质量审查，再中文提交。无 TS 业务代码变化，不重复无关构建。

## 任务 2：真实规划语义复验

先准备只读 QA 输入与本地计划预览，复用当前完整 18 段 storyboard、script、既有口播时间轴、已冻结画风与解析路线；不改 Topic/Script/Storyboard，也不创建新生成阶段。调用现有 `generateAssetPlan` 和 registry/gateway，使真实 global、分块输出、结构检查与 compiler 都实际运行。只产出本地 QA 计划文件，未审查前不激活、不生图。

路线和能力从该项目原 `asset_plan.generate` 配置快照读取；当前 QA 写实画风从已冻结 art_bible 机械映射为命名的人工 QA 风格快照传入，明确来源不是新 global 推导或新增正式画风 preset。源 timing JSON 与既有 narration_reference/脚本逐项校验，再开始调用。

限十次 gateway 调度（含现有结构修复）、每请求一次供应商尝试、max_tokens 8192、单请求系统 prompt 与输入 UTF-8 字节合计不超过 50000，串行 chunk。沿用配置的 smart DeepSeek V4 Pro。记录 effectiveRequest、完整输入输出、prompt 版本哈希、请求次数、token usage；不得打印密钥。若环境实际模型不同、费用/次数越界、时间轴或结构失败，停止，不改输入迎合输出。

探针 wrapper 必须在 gateway/provider 边界覆盖每次调用选项：`maxAttempts: 1`、`maxTokens: 8192`，不能只设环境变量，因为 generation 服务内会传入自己的尝试数。在真实发出前检查调用计数、系统 prompt 加完整输入的 byte 上限和费用预留；实际日志再次核对 attempt 数。输入/输出大小或计数防线不能依赖生成结束后的统计。

按 2026-10-03 [官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)采用更保守的高峰价：输入缓存未命中 9 元/百万 token、输出 27 元/百万 token。按输入 byte 上界加 1024 协议预留、输出 8192，每调用预留不超过 0.681 元，十次预留 8 元。使用已知 token 量另算保守估计；缺少 usage 时保留预留额，不记零。此独立本地探针不写项目费用表，报告必须明确与生图账本分别统计，供应商账单未核对。八元预留计入原 50 元总授权，不能重设起点。

人工阅读新 global：身份应仅稳定年龄、脸型、五官、体型，造型另存；新 planner 的两目标镜应有可见衣冠细节和清晰人物/御座关系。缺项标未修，不因为 schema 通过就激活。结构修复只能修正式结构问题，不能自动语义改稿。

## 任务 3：内置浏览器真实两镜验收

语义输出通过后，另存独立 QA plan/manifest，保留所有旧版本；同一 H2/E2 身份参考字节必须显式检查是否与新 global 稳定身份相容。只替换甲胄和衮冕两镜的提示为真实新 planner 输出，经现有 enrichment helper 保留身份与时代；其他生成任务和尺寸/模型不变。不把全片规划语义的小样当作已生成全片。

按 `source_segment_id=sb_004/sb_016` 与 `image_role=anchor` 在新计划中精确选择各一个 image_still；直接复制 compiler 已 enrichment 的 `prompt_draft`，禁止二次附加身份锚点。若选择原始 intent image_prompt，必须只 enrich 一次，来源与转换记录完整保存。新 global 与 H2/E2 的年龄/脸型/五官/体型不相容则停止参考复用，不手工把模型身份改成旧 QA 身份；需要新参考时另定小批。

最多两次生图、估算 0.40 元，逐张在内置浏览器确认、单次提交。新增账本和原 50 元基线差集继续累计，本轮最多十一张、估算 2.20 元，加 LLM 八元预留最多 10.20 元，低于用户总上限。每张核对请求、选中参考哈希、一次 usage、完整 job 终态和历史记录未改。

衮冕镜必须两主角同人、冕冠与礼服满足、无额外帝王、人物与御座的动作关系符合原场景，不能只验衣服。失败停止该小批，不自动第二轮改稿重试；记录实际缺口，再决定下一低耦合任务。精确初唐形制、全片统计稳定性仍未验证。

## 最终收口

逐项更新原验收矩阵、费用与剩余预算，展示实际浏览器截图，记录成功和失败全部样本。自审、独立审查、中文提交。仅所验证部分可声明通过；新 global、两镜样本和全片范围分开，不掩盖 D2 失败。
