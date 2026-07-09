# 回归检查清单（Regression Checklist）

适用范围：当前 `history-video-forge` 全链路 v1 的共享对象、prompt、harness、UI workflow 与交付验收。

## 每次涉及结构、规则或共享对象变更时，至少确认

- `AGENTS.md` 与 `harness/docs/*` 没有冲突。
- `field-design / schema-design / api-design / implementation-plan` 的关键对象命名仍然一致。
- 受影响阶段的正式对象没有旧字段回流；必要时至少回看 `pipeline-io-spec / schema-design / api-design`。
- 正式 prompt 的位置仍然唯一、清楚，并且全部在 `harness/prompts/`。
- `runtime harness` 的脚本入口、输入约束、输出目录和 artifact 语义没有被破坏。
- `harness/scripts/runtime/output/` 仍然只是运行产物目录，不污染仓库版本内容。
- semantic reviewer 是否仍为 shadow-only，未被接入自动门禁或 patch 主路径。
- 如果涉及 script 首稿质量，是否同时检查了结构通过率和口播质量观测项。
- 如果涉及 UI、render/export、publish 或 provider，是否用真实页面、运行产物、artifact 或 explicit live check 标注已验证/未验证。
- 涉及 topic runtime 写库的多文件测试是否串行运行，避免并行写 `storage/topic-candidate-library/`。

## 如本轮改动影响以下内容，必须额外回看

### 修改 shared schema

- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/architecture/pipeline-io-spec.md`

### 修改 prompt 或审校规则

- `harness/docs/prompt-management.md`
- `harness/docs/prompt-registry-spec.md`
- `docs/architecture/script-validation-spec.md`
- 如果修改 `script.writer`，还必须回看 `harness/prompts/script/script-writer.prompt.md` 与 `harness/docs/prompt-management.md` 中的 Script Writer 质量提示原则。

### 修改 harness 入口或目录结构

- `AGENTS.md`
- `harness/README.md`
- `harness/docs/definition-of-done.md`
- `harness/docs/review-checklist.md`
- `harness/docs/prompt-registry-spec.md`
- 历史设计可参考 `docs/plans/archive/topic-script/2026-04-17-harness-v1-directory-design.md`，但不能覆盖当前 README 与实际脚本入口。

### 修改 topic -> script 运行链路

- 对应 runtime harness 入口是否仍然覆盖最小验证
- 对应样例运行链路是否仍可产出：
  - topic candidates
  - topic package
  - script input bundle
  - script draft
  - validation result
  - semantic review result
- 如果使用真实 live check，是否明确输出目录并记录结果；不得把 live check 混入默认自动化门。
- 如果使用扩展样本集，是否确认它只用于显式巡检，不替代默认 `family-set.md`。

### 修改 script 首稿质量规则

- 是否区分了“可用线”“爆款首稿线”“发布线”。
- local validator 是否只做结构性质量下限，没有冒充语义审校。
- semantic reviewer 是否仍只作为 shadow 量尺。
- 是否通过 `npm run harness:topic-script-five-round-quality-check` 做 5 轮真实 topic -> script 观测记录抽读质量。
- 是否记录了 5 轮输出目录，并读取 `live-check-summary.json`、各样本 `script-draft.json`、`semantic-review-result.json`。

### 修改 UI、render/export 或 publish 链路

- 是否运行或明确跳过 `harness:ui-acceptance:smoke/full/report`。
- 是否按需要运行 render smoke 或 product acceptance live check。
- 是否检查截图、trace、summary、render response、publish export 等实际产物。
- 未实际打开页面、下载视频或导出发布包的路径，是否明确标记为 `未验证`。
