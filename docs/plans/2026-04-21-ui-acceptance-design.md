# UI Acceptance Design

## 背景

当前仓库已经具备两类验证能力：

- `vitest` 单测与集成测试
- `harness:topic-script-live-check` 真实 runtime 链路检查

这两类验证已经能证明 backend runtime、topic -> script 主链路与部分前端状态切换在工程上可运行，但它们仍然无法回答两个关键问题：

1. 前后端真实服务同时启动后，用户是否能在浏览器里完整走通项目驱动链路。
2. 前端页面是否已经达到“可交付最小标准”，而不是只有测试壳。

第四阶段的正式手动联调已经证明，当前系统最薄弱的地方不在单一接口，而在“真实链路 + 页面结果”的统一验收。因此需要新增一层正式 UI 验收机制。

---

## 目标

建立一套仓库内正式维护的 UI 自动验收机制，用于：

- 自动启动 backend 与 frontend 本地服务
- 自动使用真实浏览器打开页面并执行项目驱动主链路
- 自动创建项目、生成 topic、确认主题、生成 script
- 自动执行一次 `regen_once`、返回 topic、重选并再次进入 script
- 自动截图、收集浏览器证据、输出结构化报告
- 自动判断页面是否达到“可交付最小标准”

---

## 非目标

本方案不覆盖：

- `storyboard / assets / compose`
- 移动端矩阵
- 多浏览器矩阵
- 像素级视觉 diff
- AI 主观审美打分作为第一版硬门禁
- 用 MCP 或桌面脚本替代仓库内正式验收器

---

## 方案对比

### 方案 A：在现有 runtime harness 上继续叠加临时浏览器脚本

- 保持当前 `harness/scripts/runtime/` 为主入口
- 再拼一个脚本去起服务、开浏览器、走流程、截图

优点：

- 改动最小
- 能快速出结果

缺点：

- 服务生命周期、失败证据、浏览器 trace 都会继续分散
- 随着规则增加，会逐渐演变成手搓测试框架

### 方案 B：新增正式 Playwright UI 验收层

- 保留现有 runtime/live harness
- 新增一层 Playwright 负责真实浏览器验收与页面审查
- 输出浏览器 trace、截图、console/network 摘要与验收结论

优点：

- 职责边界清晰
- 与“真实链路 + 页面审查”的目标完全一致
- 失败时证据最完整，便于回归和排障
- 后续可扩展为阶段 gate

缺点：

- 需要新增 `playwright` 依赖和最小配置

### 方案 C：依赖 MCP 或桌面自动化做仓外验收

- 把服务启动、浏览器操作和审查主要交给桌面自动化或 MCP

优点：

- 一次性试跑快

缺点：

- 不是仓库内正式能力
- 难以复用、难以稳定回归、难以形成阶段 gate

### 结论

采用方案 B：

- backend/runtime 的真实样本回归继续由现有 harness 负责
- 新增 Playwright UI 验收层，专门解决真实浏览器链路和页面审查
- MCP 可作为临时排障工具，但不作为正式验收实现

---

## 设计原则

1. 真实链路和页面审查必须同一次运行内完成
   - 不能只跑 API
   - 不能要求人工预先启动服务

2. 先做可量化规则，再讨论更主观的视觉评价
   - 第一版以链路、结构、最小可交付规则为主
   - AI 视觉审查只作为后续可选增强

3. 复用现有 harness 目录治理
   - `harness/scripts/` 放运行器
   - `tests/harness/` 放运行器纯逻辑测试
   - `harness/scripts/runtime/output/` 放产物

4. 第一版只覆盖单浏览器、桌面端、单主链路
   - 避免在基础机制还不稳定时过早扩成矩阵

5. 失败产物必须足够排障
   - 需要 screenshot、browser trace、console、network、结构化 summary

---

## 范围

### 纳入第一版

- 自动启动 `backend` 和 `frontend`
- 自动等待 health / readiness
- 使用 Chromium 走项目驱动主链路
- 首页、项目列表、topic 工作区、script 工作区关键节点截图
- 页面结构规则检查
- “可交付最小标准”规则检查
- 输出结构化报告与浏览器证据

### 不纳入第一版

- 移动端审查
- 跨浏览器运行
- 视觉像素对比
- LLM 主观审美打分
- CI 强制门禁

---

## 验收层级

### 1. 链路层

必须能自动完成以下链路：

1. 打开首页 `/`
2. 进入 `/projects`
3. 新建项目
4. 进入 `/projects/:projectId/topic`
5. 生成 topic 候选
6. 确认主题
7. 自动进入 `/projects/:projectId/script`
8. 自动生成首轮 script
9. 执行一次 `regen_once`
10. 返回 topic
11. 再次确认主题
12. 再次自动进入 script

链路层回答的问题是：产品主链路是否真实存活。

### 2. 结构层

关键页面必须满足以下最小结构断言：

- 首页：
  - 主标题
  - 主说明
  - 主 CTA
- 项目列表：
  - 正式项目区
  - 草稿项目 / 未完成项目区
- topic 工作区：
  - 工作区标题
  - 当前轮候选区
  - 候选历史区
  - 确认主题入口
- script 工作区：
  - 工作区标题
  - 当前文案区
  - 动作区
  - `regen_once` 入口
  - 返回 topic 入口
  - trace / 运行摘要入口

结构层回答的问题是：页面是否已经摆脱空壳状态。

### 3. 可交付层

第一版只做规则化判断，不做主观美学判断。至少要检查：

- 页面主标题在首屏可见
- 主 CTA 在可视区域内
- 关键内容区不是空白，也不是只有占位提示
- topic 候选卡片数量符合预期
- script 页面出现真实生成内容，而不是只有 loading
- 页面不存在明显开发壳文案，例如 `TODO`、`debug`、`placeholder`、裸堆栈

可交付层回答的问题是：页面是否达到最小演示和提测标准。

---

## 判定规则

- `PASS`
  - 链路通过
  - 结构规则通过
  - 可交付规则通过

- `WARN`
  - 主链路通过
  - 页面主结构成立
  - 但存在非阻塞性体验问题，例如次级说明较弱、局部样式粗糙

- `FAIL`
  - 主链路断裂
  - 关键页面路由错误
  - 关键主区缺失
  - 页面白屏或只有 loading / 占位
  - 关键动作按钮不可达

---

## 目录与命令

### 目录布局

- `harness/scripts/ui-acceptance/`
  - UI 验收运行入口
  - 服务起停
  - 页面规则检查
  - 报告汇总
- `harness/scripts/runtime/output/ui-acceptance/`
  - 截图、trace、日志、summary 输出目录
- `tests/harness/`
  - 纯逻辑测试，例如规则函数、报告汇总、路径规划

### 命令入口

- `npm run harness:ui-acceptance:smoke`
  - 单主样本、桌面端、最小真实链路
- `npm run harness:ui-acceptance:full`
  - 完整 topic -> script -> regen -> 重选题 -> 再次进入 script 链路
- `npm run harness:ui-acceptance:report`
  - 读取最近一次产物并输出摘要，不重跑浏览器

---

## 执行顺序

正式 UI 验收器按固定顺序运行：

1. 检查端口占用和必要环境
2. 启动 backend
3. 等待 backend health
4. 启动 frontend
5. 等待 frontend readiness
6. 启动浏览器
7. 执行真实用户链路
8. 在关键节点截图
9. 收集 console、network、route、DOM 断言结果
10. 输出 `summary.json`
11. 关闭浏览器
12. 回收前后端进程

---

## 输出产物

每次运行至少输出：

- `summary.json`
- 关键页面截图
- browser trace
- console 摘要
- network 错误摘要
- 最终 `projectId`
- 最终路由
- 关键动作执行记录

---

## 正式门槛

### 必须 PASS

- 前后端可由验收器自动启动和回收
- 主链路全程跑通
- 路由与关键动作符合预期
- topic/script 真实生成成功
- `regen_once` 真正执行
- 二次确认后重新自动进入 script
- 关键页面截图全部生成
- 页面结构规则全部通过

### 允许 WARN

- 非关键说明文案较弱
- 轻微样式粗糙，但不影响主结构

### 直接 FAIL

- 白屏
- 主标题或主 CTA 缺失
- topic/script 主内容区缺失
- 只有 loading / placeholder，没有真实内容
- 开发壳文案外露
- 关键动作不可达

---

## 成功标准

第一版完成时，至少应满足：

- 仓库内有正式 UI 验收入口
- 可以无需人工预启动服务完成一次完整验收
- 运行后能稳定产出截图与结构化 summary
- 能把“链路断裂”和“页面仍是测试壳”自动判定为失败
- 能为后续 UI 改造提供可重复回归基线
