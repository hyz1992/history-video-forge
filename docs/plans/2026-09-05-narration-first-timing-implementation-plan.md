# 口播前置与真实时间轴实施计划

日期：2026-09-05。状态：任务 0 九次同稿真实采集完成，用量折价 1.55102 元（用户上限 5 元）；CosyVoice 全文覆盖未通过，Qwen 听审/原生边界精度未验证。不进入任务 1，没有业务改造或迁移。证据见[首轮真实记录](../records/2026-09-05-narration-provider-live-comparison.md)。

> 执行者：按 `superpowers:executing-plans` 分阶段执行，或在用户允许的协作方式下使用 `superpowers:subagent-driven-development`。项目契约优先：直接在 `dev` 主工作区，一次一个低耦合任务，不自行创建分支/worktree。每个任务先测试、再实现、再验证与自审，独立中文提交。

目标：在分镜之前得到可确认的整篇口播和原生字词时间，贯通字幕、分镜、资产与成品，不再依赖逐段估时。

设计依据：[口播前置与真实时间轴设计](./2026-09-05-narration-first-timing-design.md)。技术栈：TypeScript、Zod、Prisma/SQLite、现有 GenerationRun、Vue、Vitest、Remotion；百炼 WS 协议新增独立 adapter。

## 执行规则与交付顺序

1. 开始时重新核对 `AGENTS.md`、`docs/README.md`、本设计、相关正式架构及当前代码。这里列出的“新增”路径尚不存在是正常的；“修改”路径来自本轮代码核对。若执行时发生路径重构，先更新该任务文件表，不盲改近似同名文件。
2. 任务 0 的有限同稿比较与资格结论是后续供应商实现的前置门。无 live 授权时可完成离线验证器，但不能把资格标为通过或切换默认。CosyVoice 与 Qwen-Audio 同轮比较，不预设赢家；无合格组合时先调整选型设计并审查，不偷偷以 ASR/估算替代。
3. 默认所有测试 fake/local，严禁自动触发付费 API。真实验收单独记录请求数、费用、模型和输出；不恢复产品 quote/预算门禁。
4. 任务 1–11 的功能部署开关保持关闭，旧主链路可运行。全部 v2 消费者、旧项目兼容和真实验收通过后，才在任务 12 开放新项目默认模式。
5. 每个任务的测试先观察明确 FAIL（行为断言失败，而非环境故障），实现后同命令 PASS。格式/文档任务使用 diff/链接检查，不为纯文档伪造 TDD。
6. `npx vitest run --configLoader runner <路径>` 是下列统一命令形式；涉及共享生成态库或全量回归加 `--no-file-parallelism`。不 stage 用户已有 `.claude/`、`.zcode/`、临时脚本、storage 日志和媒体。
7. 版本联合分步接入：先导出独立的 `VersionedStoryboardPlan` / `VersionedAssetPlan` / `VersionedAssetManifest`，旧消费者可暂保留显式 v1 类型；逐任务迁移读取边界并增加版本收窄。不能提前把旧全局导出替换成联合、把编译失败留给后续任务，也不能用不安全类型断言掩盖遗漏消费者。

## Chunk 1: 模型资格、媒体合同与生命周期

### 任务 0：有限同稿比较，冻结模型/音色资格与推荐组合

新增：

- `harness/scripts/runtime/narration-provider-qualification.ts`：默认 dry-run，只有显式 `--live --confirm-live --max-requests --max-cost-cny` 才联网。
- `harness/samples/narration-timing/manifest.json`：短、中、长样例与规范化边界用例，不含账号/密钥。
- `tests/harness/narration-provider-qualification.test.ts`：验证计划、额度参数与报告格式。
- `docs/records/2026-09-05-narration-provider-qualification.md`：执行者实际验收日期、证据索引与结论；若实际执行不是当天，使用实际日期并更新引用。

步骤：

- [x] 写测试：无 live 标志实际请求数为 0；缺请求数或费用上限即拒绝；只执行冻结矩阵，不自动重试或扩大候选；错误/未知调用占额度，费用不能当零；缺 Qwen 或 CosyVoice 的有效证据不允许输出比较已完成。
- [x] 运行 `npx vitest run --configLoader runner tests/harness/narration-provider-qualification.test.ts`，观察 FAIL。
- [ ] 从 Qwen-Audio plus 官方预复刻音色表及试听确定一个普通话成年叙事候选，在 manifest 冻结准确 voice ID、来源、参数和选择理由；空值/占位符、其他模型同名音色不得进入 dry-run 成功计划或 live。不调用音色创建接口。
- [ ] 实现最小独立 WS 验证入口，不接业务 dispatcher；龙三叔、龙安洋及一个 Qwen-Audio plus 候选各合成相同的短/中/长稿，共 9 次；另预留龙安洋/Qwen 各一次语气试验，总上限 11 次，不支持则跳过并记录。基础样本统一北京、PCM 24 kHz、默认语速/音调、无情感指令。报价按当日各组合官方价计算，不复用旧 qwen3 价格。
- [x] 用 dry-run 命令 `npx tsx harness/scripts/runtime/narration-provider-qualification.ts --dry-run` 验证请求计划和预估。无明确付费授权就在此停止并记录未验证。
- [ ] 获得本轮明确预算后才执行 live：记录句序号、文本/时间索引、音频帧与累计 usage；逐组合确定 PCM 位深/声道、时间戳跨句基准、文本索引范围及单位、最终事件顺序；每个组合抽样至少 30 个发声边界。预算不足/未知失败不自动补跑，报告明确缺口。
- [ ] 按设计 §2.4 先过硬门，再隐藏标签同稿试听，用 35/25/20/10/10 权重记录各项评分及时间点，给出费用、耗时与缺失能力；差距不足 5 分按已定义规则处理。资格条目绑定 model/voice/region/protocol/参数版本和报告引用；输出样本范围内默认组合与可选语气组合，不预设 CosyVoice。只剩一个模型合格时区分资格筛选与音质优胜。
- [ ] 回跑测试 PASS，报告不提交原始正文、音频或密钥；提交 `验证口播候选模型与原生时间戳协议`。


执行进度（2026-09-05）：离线部分已提交 dc24705/be0c36b；用户后续授权 5 元，三候选各短/中/长九次已执行，累计用量折价 1.55102 元，未重试/扩矩阵/创建音色。真实事件发现结束用量省略，已兼容完整成功末句累计值并离线核销首条，只续采剩余八条。相关测试 58 项通过；九份 WAV 保持 PCM 字节不变，90 个边界样点准备完成但人工实测为 0。Cosy 两组全文覆盖失败，Qwen 映射/听审/精度待验收；两语气槽未执行。原 0.83164 元初估低于实际，当前调度另用 1.66328 元预留，非账单保证。保留未完成整项为未勾选，任务 0 整体未通过。见[真实证据](../records/2026-09-05-narration-provider-live-comparison.md)。

2026-09-06 继续任务 0：新增零网络证据检查，定位 Cosy 每句33.44秒截断及龙安洋短稿34 token/34ms、Qwen长稿1138 token等分时间；Qwen声明式文字映射可严格对齐，但听审/精度仍未验收。[诊断及有限调整提案](../records/2026-09-06-narration-timing-diagnostics.md)；本轮未新增付费请求，任务 1 保持关闭。

### 任务 1：新增口播时间、配置与版本合同

新增：`shared/src/narration/narration.schema.ts`、`shared/src/narration/narration-timing.schema.ts`、`tests/shared/narration-contracts.test.ts`。

修改：`shared/src/index.ts`、`shared/src/generation/generation-configuration.schema.ts`、`shared/src/generation/generation-configuration-resolver.ts`、`backend/src/modules/generation-cost/generation-cost.service.ts`。

职责：分别定义口播记录/请求 DTO、纯时间数据；扩展 operation 与 creative 的有限 TTS 参数、配置 hash/失效解析。不要继续把全部新合同塞进已有的大配置 schema。

- [ ] 写 strict schema 测试：负数/倒序时间、越过音频结尾、缺 audio hash、v2 缺 narration 引用、非法 tone、模型音色不兼容均拒绝；旧配置无新字段按兼容缺省读取。
- [ ] 运行 `npx vitest run --configLoader runner tests/shared/narration-contracts.test.ts`，观察 FAIL。
- [ ] 实现设计 §4–5 的字段；时间使用整数 ms、正文索引 UTF-16 半开区间；不可拆的规范化 source span 与完整合法 boundaries 显式记录。字幕快照保存完整 resolvedStyle、预设 ID/版本、overrides、断行及 resolver 版本并整体 hash，不能只有 hash 或动态默认值。把音频生成参数与字幕显示参数分开 hash。
- [ ] 新增 `script.narration.generate` operation 到实际定义所在 resolver；复用 `tts.synthesize` slot。同步 generation-cost.service 的 `OPERATION_TOKEN_ESTIMATES` 全量映射，将本 operation 标为纯媒体零 LLM token，避免扩展联合类型后编译失败。保持通用 resolver 的全局 auto 语义不变；新模式配置在任务 2B 物化为合格 fixed 模型/音色，不等待资产规划 voice_intent。
- [ ] 运行上述测试及 `tests/shared/generation-configuration-schema.test.ts`、`tests/shared/schema-contracts.test.ts`、`npm run typecheck:backend`；PASS 后提交 `定义口播记录与原生时间轴合同`。

关键测试形态（实现时使用新 schema 的实际导出名）：

```ts
expect(TimingToken.safeParse({
  id: "w1", sourceStart: 0, sourceEnd: 1,
  spokenText: "汉", startMs: 500, endMs: 400,
  providerSentenceIndex: 0, providerIndexRange: [0, 1],
}).success).toBe(false);
```

### 任务 2：独立持久化与迁移，不改变现有 active 链路

新增：`backend/src/modules/narration/narration.repository.ts`、`tests/backend/narration/narration-repository.test.ts`、`backend/prisma/migrations/20260905090000_narration_records/migration.sql`。

修改：`backend/prisma/schema.prisma`、`backend/src/db/client.ts`、`backend/src/db/prisma-client.types.ts`、`backend/src/modules/projects/project-snapshot.service.ts`、`backend/src/modules/projects/project.repository.ts`。如执行日期冲突，迁移目录按实际时间新建，不覆盖已有迁移。

真实持久化接线同时修改：`backend/src/db/repositories/prisma-first-aggregate-writer.ts`、`prisma-first-aggregate-hydrator.ts`、`project-store.ts`、`prisma-project-store.ts`。显式字段映射不会因 Prisma schema 新增字段自动贯通，不能遗漏创建、读取、active patch、hydrate 任一分支。

- [ ] 写隔离临时 SQLite 测试：旧项目读为 legacy、记录只能属于同 project/script、generationRunId 唯一；ready 不替换 active，查询不能从最新记录补 active。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-repository.test.ts`，观察 FAIL。
- [ ] 实现 NarrationRecord、NarrationSubtitleRevision 增量表及 Project 对应 nullable 指针/模式；narration repository 自己从 DB 读取，不依赖第二/第三 aggregate 的偶然热缓存。补 DbClient 测试镜像与项目 snapshot 的摘要字段，不将逐词数组灌入所有 snapshot。
- [ ] 写真实 Prisma writer→清空 Map→hydrate/ProjectStore→snapshot 回归，验证 mode、activeNarrationRecordId、activeNarrationSubtitleRevisionId 不丢失；active patch 保持 owner/同项目及字幕所属 narration 检查，不允许跨项目指针。
- [ ] 临时 DB 运行迁移与冷启动/恢复测试，不在用户运行库直接执行实验迁移；检查 FK 与删除顺序，project 删除只覆盖该项目自己的新目录。
- [ ] 运行上述测试、`tests/backend/projects/project-snapshot.test.ts` 与 `npm run typecheck:backend`；PASS 后提交 `持久化口播版本与项目活动引用`。

### 任务 2A：先保护 legacy 候选、音色池和协议入口

新增：`backend/src/modules/narration/narration-execution-compatibility.ts`、`tests/backend/narration/narration-execution-compatibility.test.ts`。

修改：`backend/src/modules/generation-config/generation-config.repository.ts`、`generation-config.controller.ts`；`backend/src/modules/generation-cost/generation-capability-readiness.ts`、`provider-dispatch-gate.ts`；`backend/src/modules/assets/voice/voice-resolution.service.ts`、`creative-voice-execution.ts`、`voice-preview.service.ts`；`backend/src/modules/assets/assets-run.service.ts`、`backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`。先不发布新 seed，不改变旧 HTTP 成功合成的语义。

- [ ] 用模拟新增 WS 目录/音色写测试：相同 traits 的新增音色不能改变 legacy auto 结果；legacy fixed/旧试听提交新 WS model 或 voice target 在外呼前拒绝；旧组合行为不变，已缓存试听可读。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-execution-compatibility.test.ts`，观察 FAIL。
- [ ] 实现设计 §2.5 的共享兼容检查，按 project mode、operation、目录协议/适用范围和实际 voice target 校验；新增目录 metadata 为 `execution_protocol=dashscope_ws`、`narration_only=true`，无标记的既有条目维持原语义。旧 auto 在评分前排除新增 narration-only 音色，不修改 matcher 的旧评分/排序。
- [ ] 项目目录及配置保存按适用范围过滤/拒绝；外呼前再次验证实际 voice target，不只检查快照 model。旧 HTTP adapter/voice.preview 不能因共享目录注册就调用新 WS 模型；新 mode 的 run override 接线在任务 5 复用该检查。禁止将“候选不可用”变成自动换音色/模型。
- [ ] 运行上述测试、`npm run typecheck:backend`，PASS 后提交 `保护旧项目音色选择与口播协议边界`；通过前不得进入新增 seed 任务。

### 任务 2B：项目级模型固定与新旧默认隔离

新增：`backend/src/modules/narration/narration-model-policy.ts`、`tests/backend/narration/narration-model-policy.test.ts`。

修改：`backend/src/modules/topic/topic.controller.ts`（真实 `POST /api/projects` 创建入口）、`backend/src/modules/projects/project.repository.ts`、`backend/src/db/repositories/prisma-first-aggregate-writer.ts`；`backend/src/modules/generation-config/generation-config.controller.ts`；`backend/src/modules/generation-cost/pricing-catalog.seed.ts`、`generation-cost-bootstrap.ts`；`backend/src/modules/assets/voice/voice-presets.ts`。任务 1/2 的共享合同与配置持久化字段同步补策略版本/选择原因及创建 selection/error DTO；迁移如需补字段新建增量 migration，不修改已执行迁移。

- [ ] 写矩阵测试：legacy auto/fixed 解析结果不变；新模式 auto 固定为任务 0 推荐组合，合格 fixed 保留，不合格显式选择拒绝且零写入；策略默认更新不追改已有项目；模型下架不自动换模，历史音频可读。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-model-policy.test.ts`，观察 FAIL。
- [ ] 按设计 §2.5 实现版本化策略，合格候选作为非全局默认目录项注册，复用 seed/bootstrap 链；断言旧全局 `isDefault`、环境 TTS 默认、用户偏好都不变。新模式创建一次事务写 mode、fixed 模型、fixed 音色与选择依据；生产开关仍关闭，新模式分支通过测试显式注入。
- [ ] 扩展真实创建 controller：可选 `narration_selection` 使用目录模型/音色档案 ID 与策略版本；不兼容继承返回 422 `narration_selection_required` 和合格选择，策略变动返回 409；新模式关闭时携带新选择不得暗中降级。事务内写项目/模式/配置，失败无半个项目，不先调用旧 create 再补配置；后续选题生成不属于本事务。
- [ ] 新模式创建复用 firstAggregateWriter 的 DB 权威用户偏好读取，而非 getUserGenerationPreference 的 Map 结果；把读取的 source revision 传入实际创建事务复查，缺记录与新增记录也做冲突判断，变化报 409 `narration_creation_context_changed`。先校验资格、再事务、提交后同步内存/项目 metadata，拒绝不创建目录；不改 legacy 创建语义。
- [ ] 写真实路由/临时 SQLite 测试：DB 为旧不合格 fixed、本实例缓存 auto 或空时返回 422 且零项目写入；读取后另一实例保存偏好时返回 409 且不留下目录；合格创建经真实 writer 冷恢复仍为新模式，准确冻结偏好 revision 与 fixed 配置。
- [ ] 配置保存也使用相同策略；auto 明确表示一次应用当前新模式推荐并物化 fixed，不持续跟随全局。未合格选择在保存前拒绝；有效 TTS 变化的下游失效由任务 6 接入。为任务 11B 升级暴露纯解析结果，不提前修改旧项目配置。
- [ ] 测试创建/保存冲突回滚，并经真实 POST 路由验证拒绝→带合格选择重试→成功，用户偏好不变；开关关闭、seed 已注册时回跑任务 2A 的 legacy auto/fixed/试听零错误协议外呼用例。注册项存在不等于 narration 资格开放；回跑上述测试、`tests/shared/generation-configuration-schema.test.ts`、`npm run typecheck:backend`；PASS 后提交 `隔离新旧项目口播模型默认与固定策略`。

### 任务 3：整篇 WS adapter 与原生时间归一化

新增：

- `backend/src/modules/narration/providers/dashscope-speech-ws-client.ts`：只处理两类候选共用的 WS 事件与音频流，协议差异以已验证能力声明区分。
- `backend/src/modules/narration/providers/dashscope-narration-provider.ts`：请求参数、结果 bundle，注入 client；使用任务 0 合格组合，不硬编码 CosyVoice。
- `backend/src/modules/narration/narration-timing-normalizer.ts`：按已验收的索引范围/单位及原生时间基准转换为全局文本与时间图。
- `tests/backend/narration/dashscope-narration-provider.test.ts`、`tests/backend/narration/narration-timing-normalizer.test.ts`。
- `prompts/narration/narrator-instruction.prompt.md`、`prompts/narration/narrator-instruction.changes.md`：保存经验证支持 Instruct 的组合使用的正式中文模板；不同指令合同使用显式模型能力分支，禁用组合不发送指令。元数据 `language: zh-CN`；接入现有 Prompt Registry 及 fixture，不在 adapter 内写正式指令文案。

修改：`backend/package.json`、根 `package-lock.json`（仅在现有 WS 依赖无法复用时添加锁定兼容依赖）；不修改旧 `dashscope-tts-provider.ts` 的 legacy 合成语义。

- [ ] 写事件 fixture 测试：534/1,500 字只发送一个 task 与一次全文 input；`task-started` 前不能送文本；流式字节顺序保留；断流、cancel 后迟到 finished、重复 sentence-end、缺失时间戳、半个 PCM 样本均不能成功。
- [ ] 写文本映射测试：相同句子出现两次、标点、阿拉伯数字读成中文、英文、代理对、一 source span 对多 token；歧义不能以模糊匹配或均分时间修复。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/dashscope-narration-provider.test.ts tests/backend/narration/narration-timing-normalizer.test.ts`，观察 FAIL。
- [ ] 按任务 0 逐组合确认的协议实现，PCM 拼接为单 WAV；保存 raw events、全局 tokens 和完整合法 boundaries，不按固定字数/时长形成只能合并的桶。覆盖同时间去重、首尾边界、不可拆 span/组合字符、无合法内部切点；duration 从最终 sampleCount/sampleRate 探测，禁止 crossfade/trim/变速。超应用上限在联网前失败。
- [ ] 测试音频和时间事件可能分批到达，只在完成事件、完整音频、有效映射全部满足时返回成功；累计 usage 只取最终/最大累计值。
- [ ] 回跑上述测试及 `npm run harness:check-prompts` PASS，提交 `接入口播整篇合成与原生时间戳适配`。

### 任务 4：原生时间生成字幕，保存不可变 bundle

新增：`backend/src/modules/narration/narration-subtitle-builder.ts`、`backend/src/modules/narration/narration-bundle-storage.ts`、`tests/backend/narration/narration-subtitle-builder.test.ts`、`tests/backend/narration/narration-bundle-storage.test.ts`。

修改：`backend/src/modules/assets/artifact-file-resolver.ts`、`backend/src/http/file-routes.ts`，复用 `backend/src/runtime/files/artifact-file-commit.ts`。

- [ ] 写测试：原始 speech 时间不因 close gaps/换行改变；SRT/VTT 无重叠、无越界；没有 timestamps 拒绝生成；完整字幕样式快照可反序列化，改预设后旧 revision 的样式/输出不变；相同 SRT 不代表相同样式 revision；storage 写一半不能 ready；其他用户/其他项目不能读取 bundle。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-subtitle-builder.test.ts tests/backend/narration/narration-bundle-storage.test.ts`，观察 FAIL。
- [ ] 实现时间图到字幕确定性转换及授权目录；builder 显式接收冻结的完整字幕设置，不能查询最新预设。文件先临时写、校验 hash 后提交 bundle manifest。初始/后续字幕各自写不可变 NarrationSubtitleRevision（含设置快照和 hash）；换字幕只切字幕引用，原音频、时间图及初始字幕不覆盖。避免在 local-subtitle-provider 的 ASR fallback 链中加入新分支产生隐式降级。
- [ ] 模拟写盘失败/DB ready 前进程退出，证明恢复可识别完整 bundle，部分输出只能候选排障；不自动删除用户历史目录。
- [ ] 回跑 PASS，提交 `由原生时间戳派生字幕并原子保存口播产物`。

### 任务 5：生成运行、确认、取消、费用与冷恢复

新增：`backend/src/modules/narration/narration-run.service.ts`、`backend/src/modules/narration/narration.routes.ts`、`backend/src/modules/narration/narration-readiness.ts`、`backend/src/modules/generation-run/narration-dispatch-handler.ts`、`tests/backend/narration/narration-lifecycle.test.ts`、`tests/backend/api/narration-api.test.ts`。

修改：`backend/src/app.ts`、`backend/src/modules/generation-run/submit-protocol.ts`、`backend/src/modules/generation-run/generation-run.service.ts`、`backend/src/modules/generation-cost/generation-cost.service.ts`、`backend/src/modules/generation-cost/pricing-catalog.seed.ts`、`backend/src/modules/generation-cost/generation-capability-readiness.ts`、`backend/src/modules/generation-cost/usage-cost-recorder.ts`、`backend/src/modules/assets/voice/voice-presets.ts`。

- [ ] 写 API/生命周期对抗测试：未确认文案先拒绝、hash/revision 冲突、跨 owner、重复幂等同 payload 复用/不同 payload 拒绝、未知外部结果不自动重发、取消后迟到结果不激活、费用字符累计不重复相加。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-lifecycle.test.ts tests/backend/api/narration-api.test.ts`，观察 FAIL。
- [ ] 建立纯 readiness 函数供 UI projection 与后端一致使用；run 使用冻结 capability、qualified voice、参数及 settings hash。只把本轮验收通过的组合标 enabled；旧音色不自动跨模型复制。
- [ ] 明确扩展 createOrRestoreGenerationRun 的有限 narration override 输入，透传到现有 resolveQuoteConfiguration 的 runOverrides 并进入快照；该函数保留旧名称不等于恢复 quote 工作流。扩展新 operation 的 computeRunPayloadFingerprint，纳入 script ID/text hash、overrides、语音配置投影/版本，旧 operation 行为不变。测试证明修改语速真实改变 provider 请求，同 key 换正文/参数返回冲突。
- [ ] 在 run override 解析及 provider dispatch 前接任务 2A 兼容检查，实际模型/音色/协议必须与资格一致；直接 API 不能绕过 UI 候选过滤，拒绝时外呼为 0。
- [ ] 对现有同步 submit 增加仅 narration 使用的“持久化后返回 202”路径，交由既有 dispatcher/lease 运行；其它 operation 保持现有响应。快照缺失 fail-closed。复用已存在恢复机制，未知供应商结果映射 run `needs_reconciliation`、record `unknown`，不另造后台队列体系。
- [ ] 实现 confirm 事务复查、取消、record 查询及超时；同 active 重复确认必须无副作用，仅重新接受目标区间不清空视觉；不同候选并发确认 CAS 拒绝迟到请求。取消持久化在前，provider cancel 尽力执行，后续事件受状态/lease fencing 约束。
- [ ] 在 GenerationRunEvent 保存 provider call intent/request key，扩展 usage-cost-recorder 的无 AssetProviderJob 媒体记账入口；新 operation usage 归文案步骤，assetProviderJobRecordId 为空，不伪造资产任务。价格使用独立模型目录项，禁止复制 qwen3 单价；未知实际费用保持 null/unknown。
- [ ] 回跑上述测试、`tests/backend/runtime/generation-run-idempotency.test.ts`、`generation-run-cold-recovery.test.ts`、`generation-run-lease-fencing.test.ts`（后三者同目录）、后端 typecheck；PASS 后提交 `接通口播准备接口与可恢复生成运行`。

### 任务 6：上游失效与模型配置变更的统一保护

新增：`backend/src/modules/narration/narration-invalidation.ts`、`tests/backend/narration/narration-invalidation.test.ts`。

修改：`backend/src/modules/script/script-record.repository.ts`、`script-regenerate.service.ts`、`script-patch.service.ts`；`backend/src/modules/generation-config/generation-config.controller.ts`；`backend/src/modules/storyboard/storyboard-run.service.ts`、`backend/src/modules/projects/project-snapshot.service.ts`。

- [ ] 写测试矩阵覆盖设计 §4.3：正文/标点/有效 TTS 参数变化使口播确认失效，视觉/字幕样式不重生 TTS；旧 run 完成不能覆盖新 active；生成新候选失败保留旧 active。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-invalidation.test.ts`，观察 FAIL。
- [ ] 统一失效入口，在 DB 事务中复查实际生效的语音设置投影而不是整个无关配置 hash；本次 override 的实际参数与生成时项目投影分别冻结，防止无关配置 revision 或合法 override 导致确认失败。后续 active 清理覆盖 publish 与最新 trace，历史记录和磁盘文件不删。
- [ ] 分镜全量/单镜重生在 dispatch 前及激活前验证 narration 来源；旧模式维持旧判断。单镜视觉重生锁定 narration/boundary/time 字段，不改变音频。
- [ ] 运行上述测试与 `tests/backend/api/script-review-actions.test.ts`、`tests/backend/api/storyboard-api.test.ts`；PASS 后提交 `统一口播版本失效与下游来源门禁`。

## Chunk 2: 分镜、资产、成品与页面上线

### 任务 7：分镜合同与真实时间投影（先不改正式 prompt）

新增：`shared/src/storyboard/storyboard-plan-v2.schema.ts`、`backend/src/modules/storyboard/storyboard-timing-projector.ts`、`tests/backend/storyboard/storyboard-narration-timing.test.ts`。

修改：`shared/src/storyboard/storyboard-plan.schema.ts`、`shared/src/index.ts`、`backend/src/modules/storyboard/storyboard-plan-compatibility.ts`、`storyboard-local-validator.ts`。

- [ ] 写测试：boundary ID 合法，相邻镜头共享端点、全文无重复/遗漏；首镜 0、末镜等于 WAV 时长；停顿归前镜；重复文本按 ID 定位；v2 缺来源拒绝，不回退按字符重算；小于 1 秒不被强行改为 1 秒。18 个各 250 ms 独立字 token 的第 6 字后可切为 1,500 ms，投影不改变 raw timing hash；不可拆 span 内边界拒绝。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/storyboard/storyboard-narration-timing.test.ts`，观察 FAIL。
- [ ] 实现 v1/v2 判别联合与 projector，start/end hints 只派生不再参与计算；source 起止及 `script_excerpt` 同样由 boundary.sourceOffset 切片派生，持久化后逐段严格一致。新 planner 不独立输出摘录，兼容输入摘录不一致即拒绝；v2 绕过旧 excerpt 的 indexOf/fuzzy/82% 容忍，只保留 v1 旧逻辑。仅做结构校验，不在本地合并“语义不佳”的镜头。
- [ ] 补双分区反例：时间 ABC/DEF、摘录 AB/CDEF 即使各自覆盖全文也必须失败；重复句按 source offsets 定位，单镜视觉重生不得改变派生摘录。
- [ ] 运行上述测试与 `tests/backend/storyboard/storyboard-local-validator.test.ts`、`tests/backend/storyboard/storyboard-plan-compatibility.test.ts`、`npm run typecheck:backend`；PASS 后提交 `让分镜时间消费已确认口播的真实边界`。联合类型产生的现有消费者收窄必须在本任务闭环，不能把编译失败留给后续任务。

回归样例必须明确区分 speech 与 visual：

```ts
// 首句说话 0.2–1.1s，第二句说话 2.4–3.6s，文件总长 4s。
expect(projectVisualIntervals(boundaries, [
  { start_boundary_id: "b_start", end_boundary_id: "b_second_sentence" },
  { start_boundary_id: "b_second_sentence", end_boundary_id: "b_end" },
], 4000))
  .toEqual([{ startMs: 0, endMs: 2400 }, { startMs: 2400, endMs: 4000 }]);
// 原始 tokens 的 200/1100/2400/3600 毫秒必须保持不变。
```

### 任务 8：分镜 planner 在规划时已看到实际时长

修改：`backend/src/modules/storyboard/storyboard-generation.service.ts`、`storyboard-run.service.ts`；`prompts/storyboard/storyboard-planner.prompt.md`、`storyboard-planner.changes.md`、`storyboard-segment-regen.prompt.md`、`storyboard-segment-regen.changes.md`；相应 Prompt Registry fixture 按 registry 定位，禁止另建业务代码 prompt。

新增：`tests/backend/storyboard/storyboard-narration-prompt.test.ts`。

- [ ] 写输入合同测试：planner 收到原文/tokens/完整 boundaries/停顿及冻结 narration 身份；输出连续 boundary ranges，摘录由任务 7 投影生成，切换到 v2 后 `recalculateSegmentTimings` 调用次数为 0。单镜重生不能改 boundary/time/source/派生 excerpt 字段；展示分句不能删掉合法切点，第 6 字切点必须实际出现在 prompt 输入中。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/storyboard/storyboard-narration-prompt.test.ts`，观察 FAIL。
- [ ] 精简调整正式中文 prompt，明确按语义和实际发声节奏规划，不猜秒数、不改正文；`language: zh-CN`、版本、changes、fixture 同步。保留 v1 的输入/output 分支，不让新 prompt 破坏旧模式回归。
- [ ] 接入任务 7 projector；stub 也选择真实边界，不让 fake 一直走估算而掩盖 v2 问题。
- [ ] 运行上述测试、`tests/backend/storyboard/storyboard-generation.test.ts`、`npm run harness:check-prompts`，PASS 后提交 `让分镜规划依据真实口播节奏选择镜头`。

### 任务 9A：资产计划引用口播，不再计划 TTS

新增：`shared/src/asset-planning/asset-plan-v2.schema.ts`、`backend/src/modules/asset-planning/narration-reference-compiler.ts`、`tests/backend/asset-planning/narration-reference-compiler.test.ts`。

修改：`shared/src/asset-planning/asset-plan.schema.ts`、`shared/src/index.ts`；`backend/src/modules/asset-planning/asset-plan-intent-compiler.ts`、`asset-planning-local-validator.ts`、`asset-planning-run.service.ts`、`segment-intent-prompt-input.ts`。

- [ ] 写测试：v2 task 中没有付费 TTS，visual task 用各段真实间隔，音色意图不覆盖已冻结 voice；依赖不再引用不存在的 TTS task；成本/调用次数不包含已生成口播。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/asset-planning/narration-reference-compiler.test.ts`，观察 FAIL。
- [ ] 实现 v2 compiler；沿用 typed visual intents/既有艺术设定，不改变 writer/reviewer。向视觉意图输入补真实间隔，`segment-intent-prompt-input` 的 script_excerpt 与 compiler 的 source_excerpt 均使用同一已验证 boundary 的派生切片；测试实际 prompt 输入与范围一致，不只证明时间数值正确。音频来源由本地引用提供。
- [ ] asset-planning-run 在 LLM dispatch 前与最终激活前从 DB 调统一 readiness，复查 script/narration/timing hash/active storyboard；测试另一实例更换口播后本实例零新 LLM 调用，已发出的旧结果不得激活。
- [ ] 运行上述测试、`tests/backend/asset-planning/asset-plan-intent-compiler.test.ts`、`tests/backend/asset-planning/asset-plan-downstream-compatibility.test.ts`、`npm run typecheck:backend`；PASS 后提交 `让资产规划复用前置口播与真实镜头时长`。

### 任务 9B：manifest、资产执行与视频时长切换

新增：`shared/src/assets/asset-manifest-v2.schema.ts`、`backend/src/modules/assets/narration-manifest-importer.ts`、`tests/backend/assets/narration-manifest-importer.test.ts`。

修改：`shared/src/assets/asset-manifest.schema.ts`、`shared/src/index.ts`；`backend/src/modules/assets/assets-manifest-builder.ts`、`assets-local-validator.ts`、`assets-run.service.ts`、`assets-execution-engine.ts`、`assets-provider-registry.ts`；`backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts`。

- [ ] 写测试：v2 全局音频仅登记一次，每镜显式 range；“生成全部”/失败重试不调用 TTS、ASR 和 tts chunking；117 秒整篇音频里的 6.4 秒镜头按 6.4 秒选择素材规格，不按 117 秒。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/assets/narration-manifest-importer.test.ts`，观察 FAIL。
- [ ] 实现 bundle 引用导入和 v2 manifest；字幕 artifact 携带 revision ID、设置 hash，并把 revision.resolvedStyle 完整映射到 `metadata.subtitle_style`，缺失/不一致拒绝。将 narration 的 provider_native 显式映射为 artifact 必填 `metadata.timing_source=provider_timestamp`，同步 narration ID、audio/timing hash，v2 schema 拒绝缺来源或 estimated/mixed，不改变 v1 枚举语义。视频 provider 从 route range 计算素材需求，沿用现有模型时长档与 split plan。保留现有 audio 参数、SFX/BGM 行为，不顺手改变视频是否有声。
- [ ] 写超上限拆视频、素材太短、可见 fallback、不触碰 narration 的回归；执行时快照不因资产配置重新挑语音模型。
- [ ] assets-run/execution 在每个外部 dispatch 与 manifest 激活前从 DB 复查来源链，覆盖冷实例口播已更换、字幕 revision 仅更新、旧视频 job 迟到的测试；必要时保留 artifact 作历史，禁止恢复旧 active manifest。
- [ ] 回跑上述测试及 `tests/backend/assets/assets-execution-regression.test.ts`、`tests/backend/assets/assets-local-validator.test.ts`、`npm run typecheck:backend`，PASS 后提交 `资产执行复用整篇口播并按镜头范围生成视频`。

### 任务 9C：字幕派生版本编排与配置保存触发

新增：`backend/src/modules/narration/narration-subtitle-revision.service.ts`、`tests/backend/api/narration-subtitle-revision-api.test.ts`。

修改：`backend/src/modules/narration/narration.routes.ts`、`backend/src/modules/narration/narration.repository.ts`、`backend/src/modules/generation-config/generation-config.controller.ts`、`backend/src/modules/assets/asset-manifest-record.repository.ts`、`backend/src/modules/projects/project-snapshot.service.ts`。

- [ ] 写 API 测试：字幕配置保存触发本地派生；同 narration/settings/builder 版本幂等；仅样式变化且 SRT 相同仍创建新快照；无 manifest 时只切字幕，有 manifest 时复用视觉创建新引用版本；失败保留旧结果但新 compose 报字幕待更新；跨用户拒绝，另实例更换 narration/字幕设置或预设版本后旧派生不能激活。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/api/narration-subtitle-revision-api.test.ts`，观察 FAIL。
- [ ] 实现配置保存到独立 revision service 的接线及设计 §7 的 subtitles 重试 API；请求开始时解析并冻结完整样式/预设版本/断行配置，builder 保持纯函数。激活事务复查当前 narration/hash/目标完整字幕设置投影（含预设版本），原子写 revision、活动字幕引用、可选新 manifest 与 compose/render/publish 失效。唯一键采用 narrationRecordId + subtitleSettingsHash + builderVersion。初始字幕与当前样式不同也要通过此服务派生，不能覆盖初始 bundle。
- [ ] 断言 TTS/ASR 请求均为 0，图/视频文件 hash 不变，初始 bundle 不被改写；回跑测试与后端 typecheck PASS，提交 `编排字幕派生版本与视觉资产复用`。

### 任务 10：compose/render 共用时间轴与字幕显示投影

新增：`shared/src/narration/timeline-frame-projection.ts`、`tests/backend/compose/narration-first-timeline.test.ts`。

修改：`backend/src/modules/compose/compose-timeline-builder.ts`、`backend/src/modules/compose/compose-local-validator.ts`、`backend/src/modules/compose/compose-run.service.ts`；`backend/src/modules/render/remotion-input-builder.ts`、`backend/src/modules/render/render-source-validator.ts`、`backend/src/modules/render/render-run.service.ts`；`renderer/src/visual-rendering.ts`、`renderer/src/audio-rendering.ts`、`renderer/src/audio-rendering.test.ts`；必要合同在 `shared/src/compose/compose-timeline.schema.ts`、`renderer/src/timeline-props.ts` 同步，端点转换放纯函数而非散落多个 renderer。新增 `tests/renderer/narration-frame-projection.test.ts` 直接测试真实消费函数。

- [ ] 写跨阶段测试：22 段总长最终等于真实 WAV，而非 chunk sum；片尾显式分离；每镜 visual range 与 storyboard/manifest 一致；字幕只显示层改变，不反向修改 narration map。直接验证 remotion-input-builder 消费冻结 `metadata.subtitle_style`，预设/项目设置后来改变不影响历史 revision；缺样式或 hash 不一致不能回落默认。
- [ ] 写 24/25/30 fps、长序列和不足一帧的测试：使用相同绝对端点取整后相减，连续无空洞，最终误差不超过一帧，零帧镜头明确失败。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/compose/narration-first-timeline.test.ts`，观察 FAIL。
- [ ] 实现 v2 compose 直接消费范围；禁止旧比例缩放 fallback。校验音频/timing hash、字幕 revision 和来源链，消费任务 9C 激活的 manifest，不在 builder 内做字幕事务；素材缺失按现有规则处理，不加速音频。
- [ ] `remotion-input-builder` 单独增加 v2 时间来源校验与绝对 cue 直通分支，绕过现有 `normalizeSubtitleCuesToNarration`，不能只改 compose。用 117 秒音频/末字幕 115 秒、首尾及句间静音 fixture 经真实 builder→manifest→render props 逐 cue 断言时间不变；缺来源拒绝，v1 估算缩放回归不变；口播只建一个全局 clip。
- [ ] visual-rendering/audio-rendering 的 v2 分支调用统一绝对端点投影，删除该分支独立 round(duration)/Math.max(1) 补帧。直接调用真实消费函数测试，不能只证明新增工具函数正确。
- [ ] compose-run/render-run 在 dispatch 与激活前从 DB 复查 narration/timing/subtitle/direct upstream 链；测试跨实例变更、冷启动、渲染中换口播或字幕，迟到输出只能留历史不得激活。
- [ ] 回跑上述测试、`tests/renderer/narration-frame-projection.test.ts`、`renderer/src/audio-rendering.test.ts`、`tests/backend/compose/compose-timeline-builder.test.ts`、`tests/backend/render/remotion-input-builder.test.ts`、`npm run harness:compose-runtime-smoke`、`npm run harness:render-runtime-smoke`，PASS 后提交 `统一真实时间轴到合成与渲染帧边界`。

### 任务 11A：文案口播面板与前后端门禁

新增：`frontend/src/components/script/NarrationPanel.vue`、`frontend/src/stores/narration.ts`、`tests/frontend/narration-panel.spec.ts`、`tests/frontend/narration-store.spec.ts`。

修改：`frontend/src/components/script/ScriptPanel.vue`、`frontend/src/stores/project.ts`、`frontend/src/stores/script.ts`、`frontend/src/router/index.ts`、`frontend/src/utils/api.ts`、`frontend/src/components/settings/CreativeVoiceSettings.vue`、`frontend/src/components/cost/ProjectCostPanel.vue`。

- [ ] 写测试：生成前、生成中、ready、失败、取消、unknown、过期状态；龙三叔禁用情感、龙安洋只可选支持项，并加入 Qwen 成为推荐组合的 fixture，证明控件读取资格能力表而非硬编码 CosyVoice 音色名；重复提交同 key；刷新恢复；超区间必须明确接受，不能只禁用按钮无解释。
- [ ] 运行 `npx vitest run --configLoader runner tests/frontend/narration-panel.spec.ts tests/frontend/narration-store.spec.ts tests/frontend/script-panel-confirm-gate.spec.ts`，观察 FAIL。
- [ ] 实现正文确认与口播确认两层交互；口播面板独立组件，不把新的播放器/轮询/错误处理全部堆入现有 ScriptPanel。只凭后端 readiness 放行新生成，不以本地“音频 URL 非空”放行。
- [ ] UI 显示预估、实测、目标区间与字幕预览；预览使用选定 revision 的完整样式快照。显示实际固定模型/音色；新模式的“应用推荐”是显式配置变更，不伪装持续 auto。修改/保存生效参数前展示失效影响。取消未保存编辑不影响 active。费用入口识别新 operation，按文案阶段显示 TTS。
- [ ] 回跑上述测试及 `npm run build:frontend`，PASS 后提交 `在文案页提供口播生成预览与确认门禁`。

### 任务 11B：下游时长展示与旧项目显式升级

新增：`tests/backend/narration/narration-mode-upgrade.test.ts`、`tests/frontend/narration-mode-upgrade.spec.ts`。

修改：`backend/src/modules/projects/project.routes.ts`、`project.controller.ts`；`frontend/src/components/storyboard/StoryboardPanel.vue`、`frontend/src/components/asset/AssetPanel.vue`、`SegmentAssetCard.vue`、`frontend/src/stores/assets.ts`、`frontend/src/stores/storyboard.ts`；项目模式升级 API DTO 放任务 1 的 narration schema。

- [ ] 写测试：旧项目可浏览与导出且标 legacy；显式升级展示受影响产物列表及模型/音色变化，用户未确认零写入；确认后保留历史、切模式并固定合格配置、使新生成回文案 gate；不兼容/配置并发冲突整笔回滚，关闭发布开关拒绝升级。v2 读取遇缺时间不回退 v1。
- [ ] 运行 `npx vitest run --configLoader runner tests/backend/narration/narration-mode-upgrade.test.ts tests/frontend/narration-mode-upgrade.spec.ts`，观察 FAIL。
- [ ] 实现 `POST /api/projects/:projectId/narration-mode/upgrade`，请求包含 expected active script/下游版本、expected 配置 revision、目标 model/voice 选择与 `confirm_invalidation: true`；复用任务 2B 策略，来源/配置变动返回 409。模式、fixed 配置、策略依据、下游失效与升级事件在同一事务提交；不能先保存新模型再升级旧模式。沿用 owner 授权，禁止恢复已废弃 quote 确认。
- [ ] 分镜和资产页把新路径“预估时长”改为实际画面区间/口播发声区间，二者差额注明停顿归属；展示旧 estimate 时明确其非权威。资产页不再提供新路径重复生口播按钮，而是回文案修改入口。
- [ ] 回跑上述测试与 `tests/frontend/stores/assets.test.ts`、`tests/frontend/stores/storyboard.test.ts`、前端构建；PASS 后提交 `补齐真实时长展示与旧项目受控升级`。

### 任务 11C：创建不兼容时的项目级选择与原地恢复

新增：`frontend/src/composables/useNarrationProjectCreation.ts`、`frontend/src/components/topic/NarrationCreationSelection.vue`、`tests/frontend/narration-project-create.spec.ts`。

修改：`frontend/src/components/topic/CreateTopicModal.vue`、`frontend/src/components/event-library/EventLibraryBrowser.vue`、`CustomTopicInput.vue`、`frontend/src/stores/project.ts`、`frontend/src/components/settings/CapabilitySlotSettings.vue`、`ProjectGenerationSettings.vue`、`CreativeVoiceSettings.vue`；复用任务 2B 的创建 selection/error DTO，不在前端自行维护另一份资格表。

- [ ] 写三入口测试：系统推荐、事件库、自定义选题继承旧 fixed/旧音色被拒绝后，分别保留筛选条件、事件 ID/角度、rawDigest；用户选定后发送 selection 重试而非重复同一 name。取消/关闭零创建且不续发选题；成功后只创建一个项目、对应选题请求一次，ensureProject 复用 ID，用户全局偏好不变。
- [ ] 运行 `npx vitest run --configLoader runner tests/frontend/narration-project-create.spec.ts`，观察 FAIL。
- [ ] composable 只协调创建和等待选择，父弹窗提供统一函数给两个子组件（通过显式回调 prop），三入口均 await 该函数后才执行各自原有选题动作；子组件不自行吞掉创建兼容错误。复用选择组件处理 422、409 策略/偏好变化及重复点击，等待选择时选择控件仍可操作。store 只传 typed DTO/error，不引用 Vue 组件；取消拒绝待续 Promise，调用者不触发生成。
- [ ] 开关关闭时解释不可用，不擅自创建 legacy。项目设置按适用模式展示/禁用模型和音色；WS 音色不触发旧付费 voice.preview，完整口播从 NarrationPanel 试听。
- [ ] 回跑测试与 `npm run build:frontend`，PASS 后提交 `补齐新项目口播配置选择与创建失败恢复`。

### 任务 12：端到端验收、发布开关与正式文档收口

新增：`harness/scripts/runtime/narration-first-runtime-smoke.ts`、`harness/scripts/ui-acceptance/narration-first-acceptance.ts`、`tests/harness/narration-first-runtime-smoke.test.ts`、`docs/records/2026-09-05-narration-first-acceptance.md`（执行时改实际日期）。

修改：`package.json`、`backend/src/config/env.ts`、`backend/src/modules/topic/topic.controller.ts`（新建模式）、`backend/src/modules/projects/project.controller.ts`（显式升级）；文档 `docs/architecture/pipeline-io-spec.md`、`script-stage-design.md`、`api-design.md`、`docs/data/field-design.md`、`schema-design.md`、`harness/README.md`、`docs/README.md`、`docs/plans/README.md`、`docs/todos/roadmap-todo.md`。

- [ ] 写 fake runtime：确认文案→原生 timing fixture→确认口播→分镜→资产计划→fake 图/视频→compose→render；断言 TTS 只发生一次、ASR 为 0、合法切点未被机械桶限制、每镜/总长同源、资产重试不重生口播；字幕样式变更与历史重放、legacy/new 默认模型并存均走真实服务。
- [ ] 运行 `npx vitest run --configLoader runner tests/harness/narration-first-runtime-smoke.test.ts`，先 FAIL，再接入生产服务完成闭环后 PASS。
- [ ] 跑浏览器验收：系统推荐/事件库/自定义三入口分别走继承旧 fixed/旧音色→创建拒绝→弹窗选择→重试成功，输入保留且全局偏好不变；取消不创建、每种选题只提交一次。再测未生成阻止推进、参数能力差异、生成进度/取消/刷新、字幕试听、超时长接受、深链、旧项目升级、改文案后过期及费用展示。记录截图/接口输出，不用组件测试冒充真实浏览器验收。
- [ ] 运行 `npx vitest run --configLoader runner --no-file-parallelism`、`npm run typecheck:backend`、`npm run build:frontend`、`npm run harness:check-prompts`；任何既有失败分类列出，不能把部分通过称全量通过。
- [ ] 经明确预算批准，用少量真实口播 + 已有/本地视觉素材完成整片验收；逐镜输出“speech 起止/visual 起止/资产需求时长/compose 起止/差值”表，并 probe 实际 MP4。优先避免为验证时间轴另付费生成视频。
- [ ] 按设计 A1–A10 逐项标 `已修 / 部分修 / 未修 / 未验证` 及证据。通过前保持 `NARRATION_FIRST_ENABLED=false`；全部通过后该开关控制新建模式及显式升级入口，不重写既有项目、不改变全局 TTS 默认值。核对任务 2B 的创建/配置分支已接入，关闭开关不自动降级已有 v2。
- [ ] 正式架构同步本设计的已实现部分，移除“字幕一直纯估算/只能资产阶段 TTS”等过时表述；保留 legacy 说明。把计划完成状态、未验证风险和回滚方式更新到索引，完成后再归档。
- [ ] 自审只有目标文件被修改，运行 `git diff --check`；提交 `验收口播前置真实时间轴并收口正式文档`。

## 本计划完成标准

不能以“音频提前生成了”作为整体完成。只有模型资格、版本门禁、原生字幕、分镜输入、资产零重复 TTS、视频时长、合成帧边界和旧项目兼容全部有证据，才可宣称时长改造完成。

本次文档交付后的安全下一步是任务 0 的离线验证入口及明确预算的有限同稿比较，不是立即执行全部改造。本次“整改”只修改文档，未执行本计划的业务实现。

文档审查记录（2026-09-05）：初版独立审查后，后续自审仍发现以下四项遗漏；本次整改替代初版的整体通过表述。此表仅标注文档整改，不代表业务实现或 live 已通过。

| 原始诉求对应的自审问题 | 文档状态 | 设计与实施证据 | 功能验收 |
|---|---|---|---|
| 替换模型不能破坏旧项目或让新模式误用旧默认 | 已修 | 设计 §2.5/8；任务 2B/6/11B/12：project fixed、全局默认不变、升级事务 | 未验证 |
| 真实时长应改善规划节奏，不能又被机械分组限制 | 已修 | 设计 §5.1–5.2；任务 3/7/8：完整合法边界与第 6 字切点回归 | 未验证 |
| 同源字幕需在改样式后仍可复现历史显示 | 已修 | 设计 §4.2；任务 1/4/9B/9C/10/11A：完整样式快照贯通真实消费者 | 未验证 |
| 找最合适模型，不能只证明首个候选可用 | 已修 | 设计 §2.1–2.4；任务 0：两模型三组合、9 次基础/最多 11 次、资格与同稿评分 | 未验证 |

最终有限循环审查（2026-09-05）：用户授权最多 3 轮，本次完成 3 轮并停止。第 1 轮关闭共享音色/协议、创建恢复、字幕渲染缩放、分镜摘录绑定四项缺口；第 2 轮补三入口创建、真实持久化映射和 DB 权威继承；第 3 轮设计及 Chunk 1/2 独立只读终审通过。完整问题证据、原始要求验收及执行门禁见[审查闭环记录](../records/2026-09-05-narration-first-design-review-loops.md)，本记录取代此前整体通过的简略表述。仅表示可开始任务 0 离线实施，不表示模型已选定或业务验收已通过。
