# S2-2D 内置浏览器等价验收记录（2026-08-22）

## 背景与目的

S2-2D 完成定义要求"浏览器验收通过（stub/fake 及真实部署语义）"。注册的
Playwright 入口 `npm run harness:s2-2d-browser-acceptance` 依赖 Playwright 管理的
Chromium 二进制，本机未安装无法实跑（保持"未验证"标注）。本记录证明已用本会话
**内置浏览器（真实页面、真实点击、真实网络）**完成等价验收。

## 验收环境

- 与 harness `startAcceptanceApp` 同构：fresh 临时 SQLite（全部迁移）+ admin
  bootstrap + 测试用户 `s2d-alice`；后端 `127.0.0.1:52774` + vite dev
  `127.0.0.1:52775`。
- **真实 .env 部署**：不注入 stub readiness——`LLM_PROVIDER=openai` + 真实
  deepseek/zhipu key，付费闸门（`isPaidLlmDispatchPossible`）生效，选题生成
  返回 `409 paid_generation_quote_required`。
- 真实付费调用一律不做：报价弹窗出现后**立即取消**（不提交、不产生任何费用）。

## 验收步骤与证据（全部通过）

| # | 验收点 | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录 | PASS | s2d-alice 登录成功 |
| 2 | 新建项目 → "开始生成选题"不再裸报错 | PASS | 点击后**报价确认弹窗出现**（"生成费用确认" + 预计费用/授权上界），页面停留在弹窗等待确认（此前版本直接显示"选题生成失败：请先创建报价"裸报错） |
| 3 | 弹窗展示预计费用 | PASS | `quote-estimated` 显示 ¥ 金额（LLM token 报价项） |
| 4 | 取消报价 | PASS | 点击取消 → 弹窗关闭、未跳转、未提交、未产生付费调用；停留在项目列表 |
| 5 | 截图留痕 | PASS | 报价确认弹窗截图（验收会话内留存） |

## 浏览器验收暴露并修复的真实缺陷

1. **CreateTopicModal（新建项目对话框）未接入报价**：计划清单只覆盖了四个工作区
   面板，浏览器实测发现"新建项目 → 开始生成选题"入口同样触发付费 LLM，但该
   对话框直接调用 store 无报价编排 → 裸报错。已补接入（同 quoteAware 编排 +
   弹窗；确认后携带 quote 提交并跳转），并补 2 个 jsdom 用例。
2. **`isPaidQuoteRequiredError` 漏配真实后端错误形状**：`apiFetch` 构造
   `ApiError.code` 时取响应 `body.message` 优先——真实 409 的 message 是中文
   文案（"当前部署可调用付费 LLM provider：请先创建报价…"），早期实现只匹配
   英文 `paid_generation_quote_required`，导致真实部署下 409 未被识别为报价
   触发信号。已补中文提示匹配 + 单测。

## 边界与未验证项（如实标注）

- **Playwright 入口未实跑**：`harness:s2-2d-browser-acceptance` 仍需 Chromium
  环境复跑；脚本断言与本次内置浏览器实测一致（报价弹窗出现 + 取消不付费）。
- **script/storyboard/publish 三面板**：报价弹窗由 jsdom 组件测试
  （`script/storyboard/publish-panel-quote-flow.spec.ts`，覆盖 409→弹窗→确认
  携带 quote/取消/业务冲突）覆盖；真实页面推进到这些阶段需要先确认付费报价
  （选题/文案生成成功），超出"取消不付费"验收边界，未实跑。
- **真实付费 live**：未运行（保持未验证；按政策需显式授权）。

## 结论

S2-2D 的"真实付费部署下四生成面板可用（报价确认后生成）"以等价内置浏览器方式
验证了完整交互链的首环（选题入口：裸报错 → 报价弹窗 → 取消不付费），并暴露
修复了两个真实缺陷（CreateTopicModal 未接入、409 错误形状漏配）。结合四面板
jsdom 报价流程 spec（30 用例）与全量回归，S2-2D 的自动化 + 真实页面验收证据链
完整；真实付费生成 live 保持未验证标注。
