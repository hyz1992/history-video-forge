# script.script-writer 变更记录

## v1.0.3 - 2026-09-17
- 新增口播草稿约束：年份与日期一律写汉字数字，不要写`公元/元`紧邻阿拉伯数字的组合。
  2026-09-17 live check 实测：`公元208年` 被供应商归一化为 `公二百零八元年`（"元"被挪到
  数字读法之后），属字符位移类改写，对齐层无法诚实回对，整次口播生成失败（fail-closed）。
  见 [live check 记录](../../docs/records/2026-09-17-narration-tie-arbitration-live-check.md)。

## v1.0.2 - 2026-09-11
- `estimated_duration_sec` 改由系统本地回填（正文去空白字数 ÷ 实测语速 5.3 字/秒，四舍五入），
  prompt 不再要求 LLM 输出该字段，也不再要求"必须落在 duration_band 区间内"。原两条约束
  （按 4.8-5.6 字/秒回填 vs 落在区间内）对高体量文案互相矛盾，曾导致 LLM 保区间谎报：
  698 字 medium 稿报 82 秒，实测口播 141.7 秒，偏差 73%。
- 档位 ↔ 实测时长的一致性改由口播确认门禁负责（实测 vs target_duration_band + 用户显式接受）。
- 本地 validator 同步废弃四条时长检查（duration_body_mismatch / duration_extreme /
  duration_severe / duration_mild_drift），设计见
  [docs/plans/2026-09-11-script-duration-estimate-backfill.md](../../docs/plans/2026-09-11-script-duration-estimate-backfill.md)。
- medium 首稿体量指引 330-450 字 → 400-500 字，与档位换算区间（75-95 秒 ≈ 400-500 字）对齐。

## v1.0.1 - 2026-09-05
- 语速假设校准：estimated_duration_sec 回填语速从 3.6-4.6 字/秒调整为 4.8-5.6 字/秒
  （本项目 qwen3-tts 实测约 5.33 字/秒：459 字正文实际口播 86.16s）。原假设按人类朗读
  语速估算，系统性高估口播时长约 25-40%，并向分镜/资产规划传导。
- script-local-validator 的估时下限公式随本地回填机制一并废弃（见 v1.0.2）。

## v1.0.0 - 2026-07-18
- 初始版本（S2-3 引入版本号）
