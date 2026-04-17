# 流水线阶段输入输出规范

本文档记录当前已经确认的阶段输入输出。

## 1. 主题阶段

### 1.1 启动输入

输入：
- 项目基础设置
- `Project Style Pack`
- 用户当前主题页选择的入口与筛选偏好
- `Recent Memory`
- `Event Registry`
- `Candidate Cache`

输出：
- 原始候选事件 / 讲法集合

### 1.2 事件识别或开放发现

输入：
- 推荐入口：用户偏好 + `Recent Memory` + 开放发现
- 事件库入口：用户选中的 event
- 自定义入口：用户原始输入

输出：
- 规范化候选事件语义

### 1.3 Event Registry 归一化

输入：
- 候选事件语义
- `Event Registry`

输出：
- 复用已有 `event_id`
- 或创建 `provisional event`
- 或进入歧义待确认路径

### 1.4 Topic Candidate Builder

输入：
- `event_id`
- `event_family`
- `family_confidence`
- Event Registry 轻量信息
- 用户偏好

输出：
- `3` 个 family 槽位 candidate

### 1.5 推荐审核与排序

输入：
- 原始 candidate
- `Recent Memory`
- `Event Registry`
- `Candidate Cache`

输出：
- `3-5` 个可展示 `Topic Candidate Card`

### 1.6 用户确认

输入：
- 用户确认的 `Topic Candidate Card`

输出：
- 冻结 `Topic Package`
- 更新 Event Registry 和记忆层
- 推进项目到 `script_ready`

## 2. Script 阶段

### 2.1 Delivery 微调

输入：
- `Project Style Pack`
- `Narrator Persona`
- `Family Bias Pack`
- `Topic Package`

输出：
- `Topic Delivery Pack`

### 2.2 Script 输入收束

输入：
- `Topic Package`
- `Topic Delivery Pack`
- `Project Style Pack`
- `Family Bias Pack`

输出：
- `Script Input Bundle`

### 2.3 正文生成

输入：
- `Script Input Bundle`

输出：
- `Script Draft Package`

补充原则：
- 默认单稿
- 只有少数 family 允许在第一稿明显整体失真时补第二稿
- 当前允许默认预备第二稿的核心 family：
  - `变法治术型`
  - `人物命运型`
- `朝堂博弈型` 只在第一稿明显写糊时条件性允许第二稿，不作为默认

### 2.4 本地硬校验

输入：
- `Script Input Bundle`
- `Script Draft Package`

输出：
- `pass`
- `regen_once`
- `hard_fail`

说明：
- `regen_once` 只用于可恢复的结构性失败，例如 beat 覆盖缺失、占位符残留、严重时长异常
- `hard_fail` 表示本地硬校验已经不能继续自动推进，本轮 script 直接失败退出
- 本地硬校验不负责 topic 回退判定，`return_topic` 只来自单一语义审校
- 时长偏差口径：
  - 不超过 `15%`：只告警
  - `15% ~ 35%`：`regen_once`
  - 超过 `35%`：`hard_fail`
- `beat_trace.excerpt` 少于 `8` 个汉字等价长度时，按“命中过弱”处理，进入 `regen_once`
- `quote_trace` 仅在正文使用了 `canonical_quotes` 时强制要求存在

更细的返回对象 schema、错误码定义与阈值说明，详见：

- [Script 校验与决策规范](./script-validation-spec.md)

### 2.5 单一语义审校

输入：
- `Script Input Bundle`
- `Script Draft Package`

输出：
- `pass`
- `patch_once`
- `regen_once`
- `return_topic`

补充原则：
- 局部问题优先 `patch_once`
- 全稿腔调或气口错误才 `regen_once`
- 只有 topic 自身矛盾才 `return_topic`
- `patch_once`：
  - 无合同冲突
  - 无全局问题标签
  - `patch_targets` 不超过 `3` 个区域
- `regen_once`：
  - 出现任意 `1` 个全局问题标签
  - 或局部问题标签数量 `>= 3`
  - 或 `patch_targets` 已覆盖 `opening + middle + ending`
- `return_topic`：
  - 只在 `selected_angle / scope / must_include_beats / forbidden_expansions / source anchors` 发生合同冲突时触发

更细的标签全集、决策阈值和第二稿触发规则，详见：

- [Script 校验与决策规范](./script-validation-spec.md)

## 3. 后续阶段

`TBD`

- storyboard 阶段输入输出
- asset planning 阶段输入输出
- assets 阶段输入输出
- compose 阶段输入输出

补充说明：

- 当前并非完全没有后续阶段高层约束
- 只是尚未进入可实施设计状态
- 高层边界与推进顺序留档见：
  - [downstream-stage-high-level-design.md](./downstream-stage-high-level-design.md)
