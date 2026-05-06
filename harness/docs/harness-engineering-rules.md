# Harness 工程规则

## 1. 总原则

- 一次只做一个低耦合子任务
- 先设计，再实现，再验证，再自审
- 所有关键边界对象必须文档化
- 所有正式 prompt 与执行规则都要有固定位置

## 2. 当前最重要的风险规避

### A. 避免 prompt 过重

- 不把规则分散到互相打架的多个 prompt 中
- 优先用结构化对象表达边界
- family/style/delivery 都必须是轻量配置，不是长篇 prompt

### B. 避免阶段打架

- topic 定义边界
- script 不得重定义 topic
- downstream 不得顺手重定义 script

### C. 避免无限重试

- 推荐阶段失败以淘汰坏候选为主
- script 阶段当前不把 patch 接入主路径
- semantic reviewer 只作为 shadow-only 量尺
- 未来如要做 patch integration，必须先单独设计 rollback、作用边界和质量保护
- 不得默认无限自动重试

### D. 避免时长误用

- 时长只做后验范围检查
- 轻微时长偏差不得直接打回正文

### E. 避免隐式状态丢失

- 必须维护仓库内 todo
- 已确认结论必须落正式文档
- 未确认项必须显式 `TBD`

### F. 避免把结构通过误判为内容质量通过

- script 本地校验 pass 只说明结构和硬合同通过
- 爆款历史口播还必须看 opening 留存、场景密度、动作/对话、压力升级和结尾余震
- 本地规则只能做结构性下限，不得用关键词或黑名单模拟语义质量判断
- 真实质量结论必须有 live check 输出和人工抽读记录

## 3. 阶段闸门

- 上一任务未验证通过，不进入下一任务
- 回改 schema/API/prompt 后，必须回跑最小检查
- 回改 script writer 或 local validator 后，必须回跑相关 script runtime 检查，并按需要做显式 topic -> script live check
