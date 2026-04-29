# UI Design-to-Code Playbook

> 适用项目：`story-video-forge2`
>
> 当前推荐方法：先用 `GPT-image-2` 生成 UI 设计图并完成人工审图，再生成带详细标注的参数图，最后按参数图进行页面编码与验收。

---

## 1. 目的

本流程用于解决以下问题：

- 仅靠口头描述直接编码，容易做成“功能正确但视觉跑偏”的工程壳
- 只有效果图，没有尺寸与参数，难以做到接近 `1:1` 的实现
- 设计确认、编码实现、自动验收之间缺少统一中间产物

本流程的目标不是替代正式设计工具，而是在当前团队不依赖 Figma 精细制图的前提下，建立一套可重复执行的 UI 落地方法。

---

## 2. 适用范围

本流程适用于：

- 新页面设计与重构
- 现有页面的大幅视觉改版
- 需要较高视觉还原度的工作台、表单页、列表页、抽屉、面板页

本流程不适用于：

- 仅改一个小按钮文案或单个 spacing bug
- 没有明确视觉目标、只做功能接线的改动
- backend / store / API / route 语义改动

---

## 3. 标准流程

### Step 1: 生成首版设计图

使用 `GPT-image-2` 先生成页面设计图。

要求：

- 先聚焦页面结构、信息层级、主次关系、主色和氛围
- 不急着讨论精确像素参数
- 一次只设计一个页面或一个低耦合页面状态
- 设计图必须只展示当前产品已确认的信息，不得借机扩展未定能力

该步骤的产物：

- `approved-mock.png` 的候选版本

### Step 2: 人工确认设计图

设计图生成后，必须由人明确审核。

审核要点：

- 信息结构是否正确
- 是否出现无意义内容、伪能力、工程壳文案
- 主次层级是否符合页面目标
- 是否违反当前阶段边界
- 是否明显偏离既定视觉方向

未通过时：

- 继续生成新图或做定向修改
- 不得进入编码

通过后：

- 明确该图成为当前页面唯一视觉基线

### Step 3: 生成带参数的设计图

当效果图通过后，再基于同一版设计稿生成“带详细标注的参数图”。

参数图必须尽量覆盖：

- 页面内容区最大宽度
- 关键 breakpoints
- 标题字号、行高、字距
- 按钮高度、宽度、圆角、间距
- 搜索框与筛选器尺寸
- 表头高度、行高、列宽比例
- 抽屉宽度、内边距、卡片间距
- 关键颜色、描边、阴影、背景层次

该步骤的产物：

- `annotated-spec.png`

### Step 4: 提取结构化参数

不要直接对着参数图凭感觉写代码。应先把参数图整理成结构化参数表。

推荐格式：

- `design-spec.json`
- 或 `design-spec.md`

推荐字段：

```json
{
  "page": "projects",
  "contentMaxWidth": 1000,
  "breakpoints": {
    "tablet": 819,
    "mobile": 479
  },
  "header": {
    "titleFontSize": 48,
    "titleLineHeight": 56,
    "buttonHeight": 36,
    "buttonRadius": 8,
    "buttonGap": 12
  },
  "toolbar": {
    "searchWidth": 280,
    "filterWidth": 140,
    "sameRowUntil": 479
  },
  "table": {
    "headerHeight": 48,
    "rowHeight": 64
  },
  "drawer": {
    "width": 360
  }
}
```

参数一旦确认，应视为冻结输入。编码阶段不得随意重新发明尺寸。

### Step 5: 按参数图编码

编码时必须遵循：

- 先做页面静态骨架，再接现有业务状态
- 先按参数表写死关键尺寸，不要用“差不多”的近似值
- 一次只改一个低耦合页面或页面状态
- 保持现有 `data-testid` 尽量稳定
- 不借 UI 重构顺手改业务语义

如果页面存在多个关键状态，按以下顺序推进：

1. 默认态
2. 有数据态
3. 空态
4. 展开态 / 抽屉态 / hover 态
5. 窄屏断点态

### Step 6: 验证与回归

编码完成后至少做三类验证：

1. 单元 / 组件测试
2. UI acceptance smoke
3. 浏览器截图复核

验证重点：

- 结构挂点是否仍在
- 页面是否出现空白页、开发壳文案、伪内容
- 关键页面状态是否和参数图一致
- 断点切换是否符合参数图，而不是出现无依据突变

如果截图与参数图差距仍然明显，不得仅以“测试通过”宣称完成。

如果改动影响 `Topic` 页面、推荐工作台、trace 入口或 runtime diagnostics 展示，还要补一条最小可追溯记录：

- 本次 smoke 的 `run_id`
- `summary.json` 中的 `project.project_id`
- 由 `project_id` 推导出的 `p_<前 8 位>` short id
- 用该 short id 在 `storage/projects/` 下递归搜索命中的项目 trace 目录

推荐直接记录成可复跑的 PowerShell 片段：

```powershell
$projectId = '<summary.json.project.project_id>'
$shortId = 'p_' + (($projectId -replace '[^a-zA-Z0-9]', '').ToLower().Substring(0, 8))
Get-ChildItem 'storage/projects' -Directory -Recurse |
  Where-Object { $_.Name -match ("\[" + [regex]::Escape($shortId) + "\]$") } |
  Select-Object FullName, LastWriteTime
```

这样做的目的不是替代 harness，而是确保 UI smoke 产物、项目级 trace 与人工巡检记录之间有稳定映射，不依赖人工记住 storage 日期或项目改名前的路径。

---

## 4. 页面级产物规范

每个正式重构页面，建议至少沉淀以下产物：

- `approved-mock.png`
- `annotated-spec.png`
- `design-spec.json`
- `implementation-notes.md`

推荐目录形态：

```text
docs/ui/<page-name>/
  approved-mock.png
  annotated-spec.png
  design-spec.json
  implementation-notes.md
```

如果暂时不建页面子目录，至少保证这些产物在 `docs/ui/` 下可追踪，不要散落在聊天记录中。

---

## 5. 与 harness 的关系

本流程不等于 harness。

职责划分如下：

- `GPT-image-2`：生成候选视觉稿和参数图
- 人工审核：确认哪一版图可作为正式视觉基线
- `design-spec`：提供编码可消费的冻结参数
- 前端实现：按参数进行静态还原和状态接线
- harness：负责最终自动验收与回归，而不是负责设计

harness 适合承接的内容：

- 页面关键结构检查
- 开发壳文案检查
- 空白页检查
- 后续截图基线对比

harness 不适合承接的内容：

- 自动生成设计图
- 自动决定哪版设计图更好
- 代替人工做审美判断

---

## 6. 与 skill 的关系

如果后续需要把这套方法做成 agent 能重复调用的能力，推荐再补一个 skill。

skill 适合承接：

- 何时先出效果图
- 何时必须停下来等人审图
- 参数图应包含哪些字段
- 如何把参数提取成 `design-spec`
- 编码和截图回归的标准顺序

repo 文档的作用是定义项目共识；skill 的作用是让 agent 更稳定地执行这套共识。

---

## 7. 当前项目建议

对 `story-video-forge2`，推荐按以下顺序沉淀：

1. 先有本 playbook，作为项目级正式方法说明
2. 后续为 `Home / Projects / Topic / Script` 分别建立页面级设计实施包
3. 再视需要补 skill
4. 最后才把可自动化检查的部分逐步纳入 harness

当前不建议：

- 直接把整套设计工作流写死进 harness
- 在没有 `design-spec` 的情况下只靠效果图编码
- 在没有人工确认设计图的情况下继续做页面实现

---

## 8. 最小执行清单

每次做正式 UI 重构前，至少确认以下清单：

- 是否已经有通过审核的效果图
- 是否已经有通过审核的参数图
- 是否已经整理出结构化 `design-spec`
- 是否已经明确本轮只处理一个页面或一个低耦合状态
- 是否已经确定测试与截图验证方式

只要以上任一项缺失，都不应直接进入“精确还原式编码”。
