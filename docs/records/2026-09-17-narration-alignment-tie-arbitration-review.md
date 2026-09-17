# 口播对齐同成本多解仲裁 —— T2 审查记录

日期：2026-09-17
任务：把口播文本↔来源对齐的"唯一最优"判定放宽为"最优 + 确定性仲裁"，并一并修复审查发现的 CRLF run 缺陷。
设计文档：[口播对齐同成本多解仲裁](../plans/2026-09-17-narration-alignment-tie-arbitration-design.md)
审查依据：[独立审查协议](../../harness/docs/independent-review-protocol.md)（T2，R1–R6）

- 审查级别：**T2**（时间轴核心合同 / validator 路径）
- `TASK_BASE_SHA`：`b226e835`（任务首个改动前的 HEAD）
- 审查时的 HEAD：`b226e835`（本任务改动全程未提交，每轮以工作树累计 diff 送审）

---

## 结论

- **0 Critical**（三轮专项审查 + 终审均为 0）。
- 终审判定：**有条件通过**。U1/U2/U3/U7 通过，U4/U5/U6 部分通过；4 条 Important 全部是**文档证据口径/表述**问题，无链路实现缺陷。
- 审查-整改轮次用满 3 轮（协议上限），第 3 轮复审仍产出 1 条文档型 Important；按协议"达到上限后停止并向用户报告"，**未启动第 4 轮**。终审的 4 条 Important 与 7 条 Minor 中，文档型项已就地更正（更正方式与留痕见下节），代码行为未因此改变。

## 轮次与 finding 计数

| 轮次 | 范围 | Critical | Important | Minor |
|---|---|---|---|---|
| 第 0 轮（初审，不计轮） | diff_reviewer + contract_reviewer | 0 | 2 | 8 |
| 第 1 轮 | 整改 CRLF run + 注释/文档同步 + 补对抗用例 → 复审 | 0 | 2 | 7 |
| 第 2 轮 | 整改注释/文档/用例命名 → 复审 | 0 | 2 | 7 |
| 第 3 轮 | 整改 token 粒度口径 → 复审 | 0 | 1 | 6 |
| 终审（两阶段，R5） | final_reviewer 去叙事化终审 | 0 | 4 | 7 |

## 有效 finding 与修复结果（按类型合并）

**代码类（均已修，均有常驻用例）**

1. **CRLF run 复合候选切开 grapheme**（第 0 轮 Important）：`甲\r\n\r\n乙` 这类"CRLF 空行分段"输入即使供应商原样返回也整篇失败——run 折叠复合候选按"1 grapheme = 1 code unit"取范围，而 `\r\n` 是长度 2 的单个 grapheme，产出的 token 区间切在 grapheme 内部被 shared 合同拒绝。修法：范围改为 `p.index + p.segment.length`（对单 code unit grapheme 逐字节 no-op）。证据：`narration-timing-normalizer.ts:113`；用例「CRLF run（空行分段）原样返回不再整篇失败」断言全部 token 的区间落在源码 grapheme 切点上。可达性由 `NARRATION_SAFE_GRAPHEME` 含 `|\r\n` 分支证实。
2. **同成本多解判定过严**（任务本体）：`mapSentence` 由"唯一最优、多解即 `fail()`"改为"最优成本 + 确定性仲裁（先被 settle 的路径胜出）+ `tie_arbitrated` 诊断"。

**文档/证据类（已更正；系终审 4 条 Important 与部分 Minor）**

3. **证据来源与样本量误述**（I1）：原表把 `storage/narration-timing-diagnosis.jsonl` 的无 `kind` 记录整体当作"真实调用"。实为 182 条中 173 条是 2 字单测 fixture（`tests/backend/narration/dashscope-narration-provider.test.ts` 的 `'甲乙'`/`'甲乙Ａ'`），真实脚本尺寸仅 9 条。已重写证据节：按来源拆分、补齐 4 个已发布成功工件的逐句差异区（正样本）、写明"13 次观测 / 4 个脚本"。
4. **论证形式错误**（I4）：原以"`normLenDiff` 从未为正 ⇒ 插入从未发生"作论证。该形式不成立——数字一对多读法会合法产生净变长（`123`→`一百二十三`，+2）。已改为正确判据"是否存在无法被任何 block 消费的 normalized 字符"，并把结论降级为"13 次观测内未出现"。
5. **剩余严格面表述不完整**（I3）：原文"时间戳本身完全不设防"与"这两条是唯一自动检查"与代码不符。已补：时间戳不重算但受结构校验（`narration-timing.schema.ts:14/63/70/96`），并列出其他 fail-closed 面。
6. **诊断覆盖面缺口登记**（I2）：`tie_arbitrated` 等诊断只覆盖 `mapSentence` 内部；`narration-timing-normalizer.ts:282/289/319/322/325/327/333/340` 为无诊断静默失败，CRLF 缺陷即属此类。已写入"残余风险"作为已知观测缺口。
7. **追溯改写历史验证记录**（M1）与**单位错误**（M4）：09-16 文档的验证小节被就地改写成本任务数字，且"467 tokens"是单位错误（467 为 `spokenText.length`，token/词数为 424，同一批同一 `audioHash`）。已恢复原快照并改为按日期追加补记，单位错误已更正。
8. 其余 Minor：`arbitratedAt` 语义（已处理前缀长度）、`slice(0,8)` 截断口径、`silentBlocks`/`blockCount`/`one-silence-block` 等过期口径、测试注释里的"唯一最优/歧义必拒"表述，均已同步。

**超出终审最小整改集、但由终审点名的一处测试补充**

9. **tie 输入的 bundle 重放用例**（M2/U5 未验证项）：新增 `tests/backend/narration/narration-bundle-storage.test.ts` 用例「同成本多解（仲裁）输入在重读重放后仍逐字节一致」，把触发仲裁的输入按 native events 落盘后 `recoverInitial`，走 `timingFromEvents` 的逐字节复算比对，闭合"仲裁路径未经过重放链"的缺口。

## 验证证据（R6：数字取自实际运行输出）

- `npx vitest run --configLoader runner tests/backend/narration/narration-timing-normalizer.test.ts` → **70 passed / 70**。
- `npx vitest run --configLoader runner tests/backend/narration/narration-bundle-storage.test.ts` → **32 passed / 32**。
- `npx vitest run --configLoader runner tests/backend/narration tests/backend/storyboard/storyboard-narration-timing.test.ts tests/shared/narration-contracts.test.ts --no-file-parallelism` → **736 passed / 9 failed（745）**；9 项全在 `tests/backend/narration/narration-execution-compatibility.test.ts`，失败点为 `AssetPlanV1.parse` 缺必填字典键（含 `global_production_notes`），必填项由 `dd367c1b` 引入且为当前 HEAD 祖先，该文件 import 列表不含 normalizer ⇒ 既有基线漂移，与本 diff 无因果路径。
- 真实 470 字工件重放（一次性探针，终审独立复跑）：`timing.json` 的 sha256 `dd8e0a95c46c…` 与重算结果**双向一致**，424 tokens、约 25ms、**0 条诊断**。该工件 `CR=0`；0 诊断说明它未覆盖新增仲裁路径，此证据只证明"对既有成功工件是纯 no-op"。
- 证据文件复核：271 行 = 85 `text-precheck` + 4 `no_alignment` + 182 无 `kind`（其中 173 条 2 字 fixture、9 条真实脚本尺寸）；`tie_arbitrated` 真实命中 0。

## 未验证（不得当 PASS）

1. **改动后的真实付费生成**：2026-09-17 无任何真实脚本尺寸的新记录，`tie_arbitrated` 的真实命中率未知；改动未经真实生成验证。
2. **run 折叠/数字通道吸收 offset 位移**：有可复现的仲裁用例，但"位移不改变正文源位置"的穷尽性论证仍只有仓库外枚举（复审方 40k 组）作证，本仓库内只有构造用例。
3. **插入类未发生**：只能表述为"13 次观测 / 4 个脚本内未观测到"，不是"从未发生"。
4. **`arbitratedAt` / `ties` 语义**：有断言但没有独立语义守卫（只断言长度非零）。
5. **非 BMP 字符、数字 block 粒度差异**：未纳入用例表（已在设计文档标为已知盲区）。

## 过程留痕

- 每轮审查后均执行 `git status --porcelain` 核对，审查子代理未改动工作树。
- 终审按 R5 两阶段执行：阶段一仅提供用户原始需求、设计/计划定位、base/HEAD 与累计 diff；阶段二再提供验证命令与结果供其核对证据。
- 审查子代理在只读验证中触发了测试自带的诊断文件追加（`storage/narration-timing-diagnosis.jsonl`，append-only），未产生其他写入。
