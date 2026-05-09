# TopicPackage Material Shape Five-Round Quality Check

日期：2026-05-08

范围：执行 `docs/plans/archive/topic-script/2026-05-08-topic-package-material-shape-for-peak-scene-absorption-implementation-plan.md` Task 5，观察 TopicPackage material-shape 调整后，`must_cover_preview` 的第二节点是否更稳定进入 `narrative_tension_map.peak_payoff`，并被 script writer 吸收到正文峰值场面。

## 运行配置

- Provider: `openai`
- Model: `glm-5.1`
- Structured model: `glm-5.1`
- 输出目录：`harness/scripts/runtime/output/2026-05-08-glm51-material-shape-five-round`
- 命令：

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_TIMEOUT_MS='180000'
$runId='2026-05-08-glm51-material-shape-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

操作备注：先按原计划使用 `LLM_TIMEOUT_MS=120000` 运行两次，均在 `topic.candidate-builder` 三次请求后超时。第三次将 timeout 提到 `180000`；外层 shell 等待超时退出，但 harness 后续完成并写出 `live-check-summary.json` 与各 sample artifact。

## 汇总结果

- total samples: 5
- sample-ready: 5/5
- local validation pass: 5/5
- TopicPackage sufficiency ok: 5/5
- semantic reviewer shadow: 4 pass / 1 patch_once
- failed samples: 0

`patch_once` 出现在 `zhuanzhu-ciwangliao`，原因是首句采用陈述句，不满足包装指令中更强设问开局偏好；reviewer 同时确认 must_include_beats、刺杀动作、结尾判断与递进结构成立。这不是材料塑形失败。

## 样本观察

### 晏子使楚：狗门之辱与底线重划

- `must_include_beats`:
  - 楚人开五尺狗门延晏子入城
  - 晏子掷地有声：使狗国者从狗门入
  - 楚人认栽，改开大门迎晏子入朝
- `peak_payoff`: 晏子掷地有声：使狗国者从狗门入
- `ending_residue`: 楚人认栽，改开大门迎晏子入朝
- script 吸收：正文以五尺狗洞开场，保留停步、拒绝弯腰、金句反击、楚人改开大门；semantic shadow pass。

观察：第二节点不是停在“被辱”标签，而是进入反击动作与金句兑现；结尾余震仍略短，但没有回到标签化总结。

### 专诸刺王僚：厨子赴死局

- `must_include_beats`:
  - 被公子光以国士之礼选中的底层屠户
  - 鱼腹中拔出匕首直刺王僚胸口
  - 专诸被王僚卫兵当场砍杀毙命
- `peak_payoff`: 鱼腹中拔出匕首直刺王僚胸口
- `ending_residue`: 专诸被王僚卫兵当场砍杀毙命
- script 吸收：正文写出专诸端鱼入席、王僚伸手掰鱼、专诸暴起、鱼腹拔匕首直刺胸口、卫兵交错刺穿身体；semantic shadow patch_once 只针对开头 hook。

观察：本轮最能说明改动收益。旧的 `strong_scene` 容易只给“鱼腹藏剑，专诸在席间暴起”这种场面概括；现在峰值位明确锁到刺杀动作，writer 正文也吃到了动作、时机、身体代价。

### 巨鹿之战：破釜沉舟

- `must_include_beats`:
  - 诸侯作壁上观楚军孤悬
  - 砸锅沉船切断最后生路
  - 九战绝杀后诸侯膝行而前
- `peak_payoff`: 砸锅沉船切断最后生路
- `ending_residue`: 九战绝杀后诸侯膝行而前
- script 吸收：正文写出诸侯闭门不出、项羽下令凿船砸锅烧帐、士兵回头看见退路被砸碎、九次冲杀、诸侯膝行；semantic shadow pass。

观察：峰值从“项羽决绝”这类评价，落成“砸锅沉船”的可视化动作，后续战果也能进入结尾。

### 鸿门宴：项羽为什么不动手？

- `must_include_beats`:
  - 刘邦带礼物低头入营谢罪
  - 范增频频示意而项羽默然不应
  - 放走刘邦后范增砸碎玉斗叹竖子不足与谋
- `peak_payoff`: 范增频频示意而项羽默然不应
- `ending_residue`: 放走刘邦后范增砸碎玉斗叹竖子不足与谋
- script 吸收：正文写出刘邦低头谢罪、项庄舞剑、范增举玉玦频频示意、项羽默然不应、张良献璧、范增砸玉斗；semantic shadow pass。

观察：这类峰值不是身体动作爆点，而是“杀机被拖成放虎归山”的决策场面。第二节点仍能被稳定映射，不会被 `strong_scene` 泛化成“宴席杀局”。

### 晏子使楚：被开狗门如何反杀

- `must_include_beats`:
  - 楚王命人开狗门迎晏子入城
  - 晏子停步抛出'使狗国者从狗门入'
  - 楚王被迫开正门迎接，首轮试探崩盘
- `peak_payoff`: 晏子停步抛出'使狗国者从狗门入'
- `ending_residue`: 楚王被迫开正门迎接，首轮试探崩盘
- script 吸收：正文写出正门锁死、五尺矮洞、守卫等他弯腰、晏子停步抛出金句、楚王被迫开正门；semantic shadow pass。

观察：重复样本仍能把狗门羞辱、停步反击、正门反转按顺序吃进正文，说明该合同对同题不同候选也有稳定收益。

## 结论

本轮优化有效，且收益主要来自“上游材料形状更像可拍场面”，不是来自 writer prompt 继续堆约束：

- Task 2 的 prompt 合同让 `must_cover_preview` 第二条更倾向峰值动作或高潮兑现。
- Task 4 的 TopicPackage 映射把第二条固定送入 `narrative_tension_map.peak_payoff`，第三条固定送入 `ending_residue` / `stakes`。
- 五轮观察中，5/5 TopicPackage sufficiency ok，5/5 local validation pass，4/5 semantic shadow pass；唯一 attention 是开头包装，不是 beat 标签化或峰值材料丢失。
- 文案质量比上一轮反标签化观察更稳定：专诸、巨鹿、鸿门宴都出现了明确动作链；晏子重复样本也从“说理标签”更明显转向“狗门/停步/反击/开正门”的场面链。

## 剩余风险

- live check 依赖 GLM-5.1，运行时长和 timeout 波动大，本轮需要 `180000ms` 才完成。
- 这仍是 5 个样本的边际观察，不能宣称覆盖所有历史故事形态。
- 个别稿件仍有包装问题，例如专诸首句没有按偏好设问，晏子结尾余震还可以更重。
- semantic reviewer 继续是 shadow-only；本记录不把 reviewer 输出升级为主链路门禁。

## 建议

可以停止继续堆 writer prompt。下一步更值得做的是小范围强化 opening package / hook input ergonomics：让上游在不新增 runtime stage、不引入 Brief 的前提下，给 writer 更明确的首句压力形状，例如“开局选择/危险/羞辱/反常识”的输入材料。此方向应先写设计与 implementation plan，再进入实现。
