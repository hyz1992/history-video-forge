# UI Workspace Redesign Design

## 背景

当前 `history-video-forge` 的 `Home / Projects / Topic / Script` 四个页面已经具备基本结构与可运行链路，但视觉呈现仍停留在工程壳阶段：

- 页面主要由文字、按钮与浅色边框面板堆叠组成
- 缺少统一的视觉语言、主次层级与阅读焦点
- `Topic` 与 `Script` 虽然能完成任务，但并不具备明显的产品感
- 最新 agent 主导验收已明确指出：当前 UI 更接近内部调试台，而不是可交付工作台

同时，旧项目已经形成一套较成熟的视觉语言，包括：

- 深色背景基底
- 暖金 / 赤陶强调色
- 渐变高光标题
- 有层次的卡片体系
- hover / focus / selected 的明显反馈

因此，本次改造的目标不是重做业务流程，而是在不改变核心逻辑的前提下，把现有四个页面升级为统一、克制、但足够有质感的历史叙事工作台。

---

## 目标

建立一套适用于 `history-video-forge` 的统一前端视觉与交互体系，并完成以下页面改造：

- `Home`
- `Projects`
- `Topic`
- `Script`

具体目标：

- 借鉴旧项目的美术风格，但不直接照搬 landing 页炫技风
- 把当前白底工程壳改造成深色历史叙事工作台
- 明确页面中的主舞台、辅助信息区与操作路径
- 改善候选项浏览、文案阅读与历史版本回看体验
- 保持现有业务逻辑、路由语义、store 合同和自动验收链路不被破坏

---

## 非目标

本次设计不覆盖：

- backend / store / API / prompt / provider 逻辑重构
- `storyboard / assets / compose`
- 选题生成与文案生成算法改造
- AI 主观审稿逻辑入仓
- 移动端专门适配体系
- 完整设计系统平台化建设

---

## 方案对比

### 方案 A：沿用当前浅色壳，做局部美化

- 保留当前白底与浅色面板
- 只补按钮、卡片、间距和少量层级

优点：

- 风险最低
- 落地最快

缺点：

- 很容易继续停留在“普通表单页”
- 难以真正摆脱工程壳观感
- 与旧项目的视觉资产关联弱

### 方案 B：借旧项目语言，做克制的深色工作台

- 保留旧项目的深色基底、暖金/赤陶强调、渐变高光与卡片层级
- 但把视觉重心放在工作区的可用性，而不是 landing 炫技

优点：

- 能明显提升产品感
- 与旧项目风格有传承关系
- 更适合 `Topic / Script` 这种长时间停留的工作台场景

缺点：

- 改动面比浅色方案更大
- 需要先建立一层共享样式基础

### 方案 C：强电影感沉浸式界面

- 大量使用氛围背景、动效、高对比视觉效果

优点：

- 视觉冲击最强

缺点：

- 容易牺牲阅读性与操作效率
- 与当前阶段“工作台优先”的目标不一致

### 结论

采用方案 B：

- 视觉上向旧项目靠拢
- 交互上保持克制和高可用
- 把产品气质从“内部工具”提升到“可交付工作台”

---

## 设计原则

1. 工作台优先，不做炫技 landing 复制
   - 首页可以有 hero 氛围，但 `Projects / Topic / Script` 必须优先服务操作效率

2. 主舞台永远只有一个
   - `Topic` 的主舞台是候选卡片与当前候选详情
   - `Script` 的主舞台是当前文案正文
   - 其他信息必须降级为辅助区域

3. 复用旧项目的视觉语言，而不是复制旧页面结构
   - 借鉴色彩、阴影、卡片、标题与氛围背景
   - 不照搬旧项目的业务布局

4. 共享样式先行，页面改造随后
   - 先建立 tokens、背景、card、button、badge、workspace shell
   - 再逐页改造，避免四个页面风格割裂

5. 尽量不打断现有测试与自动验收
   - 优先保留现有 `data-testid`
   - 结构调整只服务于更清晰的主次关系，不顺手重写业务架构

---

## 视觉方向

### 基础气质

- 深夜蓝黑色工作台背景
- 暖金与赤陶色作为品牌强调
- 柔和 radial gradient 营造历史叙事氛围
- 大标题采用渐变高光，但控制使用范围

### 组件语言

- 卡片采用深色半透明或深色实底 + 柔和边框 + 浅 glow
- 按钮分为主按钮、次按钮、幽灵按钮三层
- badge 用于表达阶段、状态、风险等级
- 面板内部加强标题、说明、正文的字号与权重差

### 交互反馈

- hover 必须明显，但不过度跳动
- selected / active 状态要清晰高亮
- focus-visible 要对键盘操作友好
- 历史版本、候选卡片、动作按钮都要有明确可点击感

---

## 页面设计

### Home

目标：

- 从“两个入口链接页”升级为真正的产品首页

结构：

- hero 区：主标题、副标题、主 CTA
- 能力卡片区：展示 `项目驱动 / 多轮选题 / 文案审校追踪`
- 流程带：`新建项目 -> 生成选题 -> 确认 -> 生成文案`

视觉要求：

- 大标题与背景氛围建立整体气质
- CTA 具备强入口属性
- 不再让说明文案平铺成普通段落

### Projects

目标：

- 从“项目列表页”升级为项目仪表盘

结构：

- 顶部 header：标题、说明、搜索、新建按钮
- 两个分区：正式项目 / 草稿项目
- 每个项目以卡片形式展示当前阶段与主要动作

视觉要求：

- 正式项目卡与草稿项目卡形成主次区分
- 搜索区与分组区具有统一的工作台风格
- hover 态让卡片像“进入工作区”的入口，而不是静态信息块

### Topic

目标：

- 从“候选按钮堆砌”升级为选题审阅工作台

结构：

- 左侧主区：当前轮候选卡片网格
- 右侧辅助区：工作区说明、历史轮摘要
- 候选详情区：展示当前选中候选的完整信息与确认动作

视觉要求：

- 候选必须呈现为真正的卡片，而不是长文字按钮
- 当前选中项有强烈 selected 态
- 历史区存在，但视觉权重明显低于当前轮
- 确认按钮必须形成明显的下一步动作焦点

### Script

目标：

- 把“当前文案”提升为绝对主舞台

结构：

- 顶部 header：标题、状态、返回选题
- 双栏工作区：
  - 左侧：当前文案正文
  - 右侧：动作、审校结论、执行状态
- 底部辅助区：trace、runtime diagnostics、历史版本

视觉要求：

- 文案阅读体验优先，正文行宽、行距、段距都要优化
- 风险/审校/trace 不再和正文抢视觉焦点
- 历史版本更像版本卡片或时间线，而不是裸列表

---

## 文件范围

### 核心页面

- `frontend/src/views/HomePage.vue`
- `frontend/src/views/ProjectsPage.vue`
- `frontend/src/views/TopicPage.vue`
- `frontend/src/views/ScriptPage.vue`

### 共享组件

- `frontend/src/components/topic/TopicCandidateList.vue`
- `frontend/src/components/topic/TopicCandidateDrawer.vue`
- `frontend/src/components/topic/TopicTabs.vue`
- `frontend/src/components/script/ScriptDraftPanel.vue`
- `frontend/src/components/script/ScriptHistoryPanel.vue`
- `frontend/src/components/script/ScriptReviewPanel.vue`
- `frontend/src/components/script/ScriptStatusPanel.vue`
- `frontend/src/components/script/ScriptTracePanel.vue`

### 共享样式层

当前 `frontend/src/main.ts` 尚未引入全局样式入口，因此本次设计建议新增一层共享样式，例如：

- `frontend/src/styles/main.css`
- 或等效的全局样式入口

用于承载：

- design tokens
- workspace shell
- card / button / badge / panel 基础样式
- 页面背景与容器规则

---

## 验证策略

每个阶段都应保持现有自动验收能力不回退：

- 相关前端测试通过
- `npm run harness:ui-acceptance:smoke` 通过
- 最终 `npm run harness:ui-acceptance:full` 通过

此外，最终还需要继续做 agent 截图审查，确认页面不再是简单的文字与按钮堆砌。

---

## 成功标准

完成时至少满足：

- 四个页面拥有统一的视觉语言
- 首页具备清晰的产品入口感
- 项目页具备真正的仪表盘观感
- `Topic` 页面看起来像候选审阅工作台，而不是按钮列表
- `Script` 页面看起来像文案工作台，而不是调试信息平铺页
- 最新自动化截图能明显体现“产品感”，而不是“工程壳”
