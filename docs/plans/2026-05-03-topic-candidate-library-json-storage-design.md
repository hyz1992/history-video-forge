# Topic Candidate Library JSON Storage Design

## 背景

上一版 `topic candidate library` 采用了：

- `seed family / seed profile` 目录分层
- 单候选一文件
- `YAML front matter + Markdown body`

这条路线已经验证了两件事：

- 候选库沉淀与受控 fallback 机制本身是成立的
- 人工可以直接打开文件做巡检

但真实使用里暴露了两个更关键的问题：

1. 单候选一文件会快速生成大量零散文档，机器批量读写、状态迁移和去重都不自然。
2. 对“候选库应该先服务系统读写，再兼顾人工巡检”的目标来说，Markdown 文档主存储并不是最合适的主格式。

因此，这次设计变更不再继续修补“分散文档文件”方案，而是正式把候选库主存储切换为：

- `按 seed-profile 聚合的 JSON 文件`

## 目标

新的候选库主存储需要满足：

- 跨项目复用
- 按 `seed family / seed profile` 分类
- 机器稳定读写优先
- 人工仍可直接打开查看
- 保持当前 `raw / selector_pool / final_selected / fallback_ready / expired` 生命周期语义
- 继续服务“更多候选预览”和“受控 fallback 复用”

## 不做什么

- 不引入数据库
- 不做全局推荐系统
- 不做跨 family 自动混用
- 不做本地伪语义判断
- 不让候选库绕过 selector 直接顶替最终结果
- 不在本轮顺手重做 topic 主链路

## 方案对比

### 方案 A：保留目录分层，但每个候选单独一个 JSON 文件

优点：

- 比 Markdown 更机器友好
- 对现有目录结构改动较小

缺点：

- 仍然是大量零散文件
- 状态迁移和批量写入仍然别扭
- 本质上没有解决“文件过碎”的核心问题

### 方案 B：每个 `seed-profile` 一个聚合 JSON 文件

结构示意：

- `storage/topic-candidate-library/<seed-family>/<seed-profile>/candidates.json`

优点：

- 每个 seed-profile 的候选集中管理
- 机器读写自然，便于整体替换、去重、排序和状态迁移
- 人工巡检时也只需要打开一个文件
- 与现有 family/profile 边界一致，迁移成本可控

缺点：

- 单文件会随候选增长而变大
- 需要定义稳定 schema 与写回策略

### 方案 C：全局单一 `index.json`

优点：

- 最集中
- 机器实现表面上最简单

缺点：

- 很快膨胀
- 不利于按 seed 巡检
- 更容易把本地逻辑推向“全局智能索引”

## 结论

采用方案 B：

- 每个 `seed-profile` 一个聚合 JSON 文件
- 保留 family/profile 目录边界
- 废弃“单候选一 Markdown 文件”作为主存储

## 存储结构

新的主存储结构：

- `storage/topic-candidate-library/<seed-family>/<seed-profile>/candidates.json`

其中：

- `<seed-family>` 和 `<seed-profile>` 继续使用稳定 ASCII-safe slug
- JSON 文件是该 seed-profile 的唯一正式主存储

第一版不再要求同目录下维护 `notes.md`、`index.md` 或其他人工副本。

## JSON 顶层结构

建议顶层格式：

```json
{
  "schema_version": 1,
  "seed_family": "中国古代重大历史事件",
  "seed_profile": "中国古代重大历史事件",
  "seed_family_slug": "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
  "seed_profile_slug": "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
  "updated_at": "2026-05-03T00:00:00.000Z",
  "candidates": []
}
```

顶层职责：

- 明确 schema 版本
- 保留原始 seed 文本和值班 slug
- 提供整体更新时间
- 容纳本 seed-profile 下的全部候选

## Candidate 结构

每个候选对象至少包含：

- `candidate_id`
- `event_identity`
- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `status`
- `source_project_id`
- `source_topic_run_id`
- `source_seed_family`
- `source_seed_profile`
- `first_generated_at`
- `last_selected_at`
- `times_selected`
- `times_seen_in_pool`
- `notes`

其中：

- `notes` 改为 JSON 字符串字段，而不是 Markdown body
- 如果暂时没有人工备注，写空字符串即可

## 生命周期状态

保留现有状态集合：

- `raw_generated`
- `selector_pool`
- `final_selected`
- `unused`
- `fallback_ready`
- `expired`

语义不变，变化只在主存储格式。

## 读写模型

### 写入

每次 recommendation runtime 只做：

1. 读取对应 `candidates.json`
2. 按 `candidate_id` 或稳定主键合并候选
3. 更新状态与计数
4. 原子性写回整个 JSON 文件

第一版不做增量 patch 文件，不做分片文件。

### 读取

fallback 读取时只做：

1. 加载同 `seed family / seed profile` 的 `candidates.json`
2. 过滤 `fallback_ready`
3. 继续交给 selector

不允许：

- 跨 family/profile 混读
- 用标题模糊匹配做“近似复用”

## 人工可读性

JSON 仍然满足“人也可读”，但优先级改成：

1. 机器主存储正确
2. 人工可直接打开理解

因此这一版不再追求“像文章一样可读”，而是追求：

- 字段完整
- 缩进稳定
- 同类字段顺序稳定
- 打开即可看出候选来源、状态和复用资格

## 迁移策略

不做自动迁移旧 Markdown 库。

原因：

- 当前旧库主要是实验性产物
- 自动迁移会增加实现复杂度
- 旧数据里已经混入了被手工回归脚本污染过的样本

因此迁移策略采用：

- 新格式上线后，JSON 目录作为唯一正式主存储
- 旧 Markdown 条目视为历史试验产物，不再作为正式读取来源

必要时允许人工清理旧目录，但不把“清库工具”放进本轮必做范围。

## 风险与取舍

### 优势

- 大幅减少文件碎片
- 更适合程序稳定读写
- 更容易做后续 schema 演进

### 代价

- 失去 Markdown body 那种“文档感”
- 单个 seed-profile 文件会持续增长

当前阶段接受这个取舍，因为主目标已经从“人工文档感”转向“机器主存储 + 人工可巡检”。

## 成功标准

满足以下条件即可认为这次设计变更有效：

- 真实运行不再生成单候选散落 Markdown 主文件
- 每个 seed-profile 只维护一个正式 `candidates.json`
- `raw / selector_pool / final_selected / fallback_ready` 仍可稳定沉淀
- fallback 仍然只读同 family/profile，且仍服从 selector
- 人工打开 `candidates.json` 能直接看懂候选来源、状态和复用资格
