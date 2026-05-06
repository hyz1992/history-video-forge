# Topic Script Expanded Family Set

扩展真实巡检样本集，用于观察 topic -> script 首稿质量与 semantic shadow 分布。

该集合不作为默认自动化门，不替代 `family-set.md`。

- `harness/samples/topic-script/yanzi-shichu.sample.json`
- `harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json`
- `harness/samples/topic-script/julu-zhizhan.sample.json`
- `harness/samples/topic-script/hongmenyan.sample.json`

约束：

- 只用于显式 live check 或人工观测记录。
- 不因单次真实模型输出波动直接回改 prompt 或主链路。
- reviewer 结果只作为 shadow-only 分布观察。
