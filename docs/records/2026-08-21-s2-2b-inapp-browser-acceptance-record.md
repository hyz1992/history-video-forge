# S2-2B 内置浏览器等价验收记录（2026-08-21）

## 背景与目的

S2-2B 完成定义要求"浏览器验收通过（stub/fake）"。注册的 Playwright 入口
`npm run harness:s2-2b-browser-acceptance` 依赖 Playwright 管理的 Chromium 二进制，
本机未安装导致无法实跑（多轮审查均标注"未验证"）。本记录证明已用本会话
**内置浏览器（真实页面、真实点击、真实网络）** 完成等价验收，覆盖
`harness/scripts/ui-acceptance/s2-2b-browser-acceptance.ts` 声明的全部验收点。
Playwright 脚本保留为可重复回归入口，待 Chromium 环境复跑（保持"未验证"标注）。

## 验收环境

- 与 harness `startAcceptanceApp` 同构：fresh 临时 SQLite（全部迁移）+ admin
  bootstrap + 测试用户 `s2b-alice`；后端 `127.0.0.1:3171`（createHttpServer +
  PrismaSessionStore）+ vite dev `127.0.0.1:5183`。
- stub 部署语义：无 DashScope 凭据（启动时显式清除）→ 试听走免 quote fake
  本地合成（P1-1a 修复路径）。
- 注意：本机 `.env` 含真实 LLM 配置 → 工作区"选题生成"被付费 LLM 闸门拦截
  （`paid_generation_quote_required`），不影响本验收目标（项目已创建，
  项目设置/试听/失效预览不依赖 topic 生成成功）；该现象同时是闸门
  fail-closed 的页面级旁证。

## 验收步骤与证据（全部通过）

| # | 验收点 | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录 | PASS | s2b-alice 登录成功，跳转首页 |
| 2 | 设置页创作三区渲染（fresh DB） | PASS | 首音色卡片 5（含自动匹配 1）、画风 preset 3（含"不启用"）、字幕 preset 3（含系统默认）——fresh DB 首次打开即见 seed 音色（P1-3 修复页面级证据） |
| 3 | 画风选择保存 + 刷新保持 | PASS | 选"古典水墨"→ 保存 → reload 后 `class="art-card active"` |
| 4 | 字幕 preset + 安全覆盖 + 预览框 | PASS | 选"粗描边醒目"→ 覆盖表单出现 → 真实键入字号 60 + blur → 预览框 style 含 `font-size: 60px`；`style_id/font_family/safe_area` 无覆盖入口 |
| 5 | 字幕偏好保存 + 刷新保持 | PASS | reload 后 preset active 且覆盖输入值回显 60 |
| 6 | 项目创建 + 项目设置对话框三区 | PASS | 新建项目进入工作区 → 头部齿轮（`open-project-settings`）→ 对话框 `project-creative-settings` 渲染，三区计数同 #2 |
| 7 | 项目冻结继承用户默认 | PASS | 对话框内"古典水墨"与"粗描边醒目"均 active |
| 8 | 画风变更失效预览 | PASS | 切"电影质感"→ 预览显示"受影响阶段：资产规划"及对应说明 |
| 9 | 项目设置内试听（首次，免 quote） | PASS | 点击冷峻权谋型试听：无错误提示、**无报价确认弹窗**（stub 路径直连生效，P1-1a 页面级证据）；DB `VoiceProfile.previewAudioUri` 写入（85414 字符 wav base64）、`updatedAt` 更新 → generated 分支执行并持久化 |
| 10 | 二次试听命中 cached | PASS | 二次点击无错误；DB `previewAudioUri` 长度不变（85414）且 `updatedAt` 完全不变（13:30:24.996）→ cached 分支（无重写），同时是三审 create-only seed 修复的运行态保护证据（中间多次 seed 未清缓存） |
| 11 | 视觉证据 | PASS | 项目设置对话框截图（三区 + 失效预览，验收会话内留存） |

自动化备注：步骤 4 首次尝试失败是验收脚本问题（fill+Tab 未触发原生 change
事件），改用真实键入 + blur 后通过——非产品缺陷。

## 边界与未验证项（如实标注）

- **Playwright 入口未实跑**：`harness:s2-2b-browser-acceptance` 仍需 Chromium
  二进制环境复跑；本记录为等价真实页面验收，脚本本身保持"未验证"。
- **审计 DB 持久化在本环境不可观测**：本 bootstrap 走 `createHttpServer`
  （与 S2-2A harness 同构），不接线 `thirdAggregateWriter` →
  `appendVoicePreviewAudit` 只落内存镜像。生产路径（server.ts 启动）接线
  writer；持久化合同由 `tests/backend/assets/voice-preview-review.test.ts`
  （注入 writer 断言 `appendAuditLog` 调用）覆盖。
- **真实付费试听 live**：未运行（保持未验证；按政策需显式授权）。

## 结论

S2-2B 完成定义中的"浏览器验收通过（stub/fake）"以等价内置浏览器方式达成：
创作三区、保存/继承/失效预览、免 quote 试听（generated → cached）全部在
真实页面验证通过。结合后端 e2e（`tests/backend/s2-2b-e2e-acceptance.test.ts`）
与 jsdom 组件测试，S2-2B 的自动化 + 真实页面验收证据链完整；待第三轮整改
（`01e4fe0`）复核通过后可宣告 S2-2B 收口。
