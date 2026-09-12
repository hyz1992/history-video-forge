# Script 预估时长本地回填设计

适用项目：`history-video-forge`
日期：2026-09-11
关联：`prompts/script/script-writer.prompt.md` v1.0.2、`backend/src/modules/script/script-local-validator.ts`

---

## 背景与问题

`estimated_duration_sec` 原先由 script writer LLM 按 prompt 约束输出。prompt 同时要求"按约 4.8–5.6 字/秒回填"与"`estimated_duration_sec` 必须落在 `duration_band` 区间内"。对体量高于档位所容字数的文案，两条约束互相矛盾，LLM 选择保区间而谎报：

- 实测案例：698 字、medium 档（75–95s），LLM 报 82s（≈8.5 字/秒，默读速度），实测口播 141.7s（≈4.93 字/秒），偏差 73%，并向 UI 显示与下游规划传导。

TTS 实测语速两个样本：

| 样本 | 正文 | 实测时长 | 语速 |
|---|---|---|---|
| 2026-09-05 | 459 字 | 86.16s | 5.33 字/秒 |
| 2026-09-11 | 698 字 | 141.7s | 4.93 字/秒 |

回填常量取 5.3 字/秒（与 prompt v1.0.1 语速说明一致）。

## 设计

1. **本地回填**：`script-generation.service.ts` 的 `normalizeScriptDraft` 在 LLM/stub 输出归一化后、`ScriptDraftPackage.parse` 之前，按 `script_text` 去空白字数 ÷ 5.3 四舍五入（下限 1s）写入 `estimated_duration_sec`，覆盖 LLM 输出或补齐缺省。stub 确定性草稿的硬编码 88 一并移除。
2. **validator 废弃四条时长检查**：
   - `duration_body_mismatch`：回填后"字数 < 估时×3.6"恒不触发，规则失效；
   - `duration_extreme` / `duration_severe` / `duration_mild_drift`：估时改由字数派生后，"估时 vs 档位偏差"等价于"体量 vs 档位"，不再属于估时校验职责；
   - 档位与实测时长的一致性改由口播确认门禁负责：实测 `durationMs` vs `target_duration_band` + 用户显式接受 `accept_duration_outside_band`（已实现，见 `narration.repository.ts` 确认事务）。
   - `decision` 的 hard_fail 列表移除 `duration_extreme`；`metrics.chars_per_estimated_second` 保留（回填后 ≈5.3，仅诊断用）。
3. **prompt 修订**（v1.0.2）：`estimated_duration_sec` 移出必填输出清单与 JSON 骨架，标注"由系统回填，无需输出"；口播草稿约束改为档位 ↔ 字数换算区间（short 240–370 字、medium 400–500 字、long 480–740 字，按 5.3 字/秒），不再要求"估时落在区间内"；medium 首稿体量指引 330–450 字 → 400–500 字，与换算区间对齐。
4. **契约文档同步**：`script-validation-spec.md` 4.4/4.5、`script-stage-design.md` 阈值表、`field-design.md` 字段描述。

## 明确不改

- topic 档位语义与阈值；口播确认门禁；shared schema；TTS/口播链路。
- 存量 script 记录不追溯改写（已存 82s 的项目保留原值，下次重新生成才回填）。
- 前端 `ISSUE_CODE_MAP` 三个失效码标签保留：存量校验记录仍可能显示这些历史错误码。
- 生成时"体量 vs 档位"的软提示、存量记录迁移 —— 后续可选，不在本次范围。

## 验证

- 单测：回填计算（698→132、空白剥离、下限 1s、空文本 0）；LLM 输出被本地覆盖；validator 对高体量 medium 稿不再产生任何时长错误码；旧时长用例改写。
- 回跑：`tests/backend/script` 全套件 + `tests/frontend/script-panel-confirm-gate.spec.ts`。
- 审查：T2 协议（diff_reviewer + contract_reviewer → final_reviewer R5 两阶段）。
