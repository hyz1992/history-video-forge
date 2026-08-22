# S2-2C 内置浏览器等价验收记录（2026-08-22）

## 背景与目的

S2-2C 完成定义要求"浏览器验收通过（stub/fake）"。注册的 Playwright 入口
`npm run harness:s2-2c-browser-acceptance` 依赖 Playwright 管理的 Chromium 二进制，
本机未安装导致无法实跑（保持"未验证"标注）。本记录证明已用本会话**内置浏览器
（真实页面、真实点击、真实网络）**完成等价验收，覆盖
`harness/scripts/ui-acceptance/s2-2c-browser-acceptance.ts` 声明的全部验收点。

## 验收环境

- 与 harness `startAcceptanceApp` 同构：fresh 临时 SQLite（全部迁移）+ admin
  bootstrap + 测试用户 `s2c-alice`；后端 `127.0.0.1:58951`（createHttpServer +
  PrismaSessionStore）+ vite dev `127.0.0.1:58952`。
- 目录多候选注入（stub/fake 部署 + 自定义 seed）：LLM 候选表
  `LLM_MODEL_CANDIDATES_V1` 种入 smart/flash 两槽非默认条目（DeepSeek V4 Pro /
  智谱 GLM-4，元数据来自候选声明），媒体三槽单候选（env 默认模型）。
- 注意：本机 `.env` 含真实 LLM 配置 → 工作区"选题生成"被付费 LLM 闸门拦截
  （`paid_generation_quote_required`），不影响本验收目标（项目已创建，项目
  设置/高级区/失效预览不依赖 topic 生成成功）；该现象同时是闸门 fail-closed
  的页面级旁证（与 S2-2B 记录同因）。

## 验收步骤与证据（全部通过）

| # | 验收点 | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录 | PASS | s2c-alice 登录成功，跳转首页 |
| 2 | 设置页高级设置区五槽渲染 | PASS | `cap-slot-*` 五槽全渲染；llm.smart/llm.flash 各 2 个候选（DeepSeek V4 Pro · 高质量 · slow / 智谱 GLM-4 · standard · 快速——元数据来自候选声明，同一模型跨槽位一致） |
| 3 | 默认 auto 选中 | PASS | 五槽 auto radio 均 checked |
| 4 | 单候选槽位"当前仅配置 X" | PASS | 分镜图生成/分镜视频生成/口播配音三槽显示"当前仅配置 万相文生图（wan2.6-t2i）/万相图生视频（wan2.7-i2v）/通义千问 TTS（qwen3-tts-instruct-flash）（自动与固定当前等价，固定可锁定语义）" |
| 5 | 选候选固定 → 保存 → 刷新恢复 | PASS | 选"智谱 GLM-4"→ 保存 → reload 后该候选 radio 仍 checked、auto 未选中（服务器 PATCH 生效） |
| 6 | 项目创建 + 项目设置高级区 | PASS | 新建项目进入工作区（`open-project-settings`）→ 对话框高级区五槽渲染 |
| 7 | 项目继承用户默认 fixed | PASS | 项目对话框 llm.smart"智谱 GLM-4"checked（继承自创建时用户默认，配置来源标注"继承自创建时用户默认（来源偏好版本 3）"） |
| 8 | **候选加载缺陷（真实页面发现并修复）** | PASS（修复后） | 首开项目设置对话框高级区五槽全部显示"当前部署无可用模型"——`ProjectGenerationSettings` 打开时未调用 `store.loadCapabilities()`，候选列表为空。修复（watcher 补 `store.loadCapabilities()`）后重开对话框候选正常渲染；jsdom 测试补断言（`expect(store.loadCapabilities).toHaveBeenCalled()`） |
| 9 | 切换候选 → 失效预览含 LLM 生成 | PASS | 固定 smart 改"DeepSeek V4 Pro"→ 预览"受影响阶段：LLM 生成（选题/文案/分镜/资产规划/发布）"及对应说明 |
| 10 | 保存项目设置 | PASS | 点击保存 → PATCH 成功 → 对话框关闭（无报错） |
| 11 | 视觉证据 | PASS | 设置页全页截图 + 项目设置对话框截图（验收会话内留存） |

## 边界与未验证项（如实标注）

- **Playwright 入口未实跑**：`harness:s2-2c-browser-acceptance` 仍需 Chromium
  二进制环境复跑；本记录为等价真实页面验收，脚本本身保持"未验证"。
- **付费链路**（quote → 提交 → 执行消费快照模型）由
  `tests/backend/s2-2c-e2e-acceptance.test.ts`（7 用例，真实 tier-aware
  provider 工厂 + fetch 断言 baseUrl/model）覆盖；真实付费 live 未运行（未验证）。
- **选题生成被付费闸门拦截**是本机 `.env` 真实 LLM 配置所致（与 S2-2B 记录
  同因），非 S2-2C 缺陷；项目创建与设置流程不受影响。

## 结论

S2-2C 完成定义中的"浏览器验收通过（stub/fake）"以等价内置浏览器方式达成：
五槽高级设置区渲染（多候选/单候选/无候选三态文案）、固定选择保存与刷新恢复、
项目继承用户默认、失效预览（llm_generation）与保存闭环全部在真实页面验证
通过，并暴露修复了项目设置高级区候选未加载的真实缺陷。结合后端 e2e 与
任务 1-8 单元/组件测试，S2-2C 的自动化 + 真实页面验收证据链完整。
