# 分镜规划页面优化计划

日期：2026-06-25

状态：待执行

---

## 任务

对 `StoryboardPanel.vue` 分镜规划前端页面进行三阶段渐进式优化，补齐信息展示缺口、优化卡片信息层次、增强叙事结构可视化。

## 一句话结论

`StoryboardSegment` schema 定义了 17 个字段，当前 UI 仅渲染 8 个。分三阶段依次补齐缺失字段、重构卡片布局为折叠式摘要+详情、增加叙事弧线进度条与角色差异化样式。

## 背景

当前 `topic -> script -> storyboard -> asset planning -> assets -> compose -> renderer` 后端链路均已 v1 完成。分镜规划后端已能稳定产出 `StoryboardPlan`，包含 17 个字段的丰富数据。但前端 `StoryboardPanel.vue` 的展示层面仍有较大优化空间：

- `scene_description` 是 schema 必填字段但完全不显示
- `visual_elements`、`content_type`、`editing_hint`、`risk_notes` 等关键字段缺失
- 所有 segment card 样式一致，用户无法区分叙事结构
- 三列等宽布局在段落多时可读性下降

## 当前状态分析

### Schema 字段 vs UI 渲染对照

[StoryboardSegment schema](file:///d:/ai_learn/history-video-forge/shared/src/storyboard/storyboard-plan.schema.ts) 共 17 个字段。

#### 已展示（8 个）

| 字段 | 展示方式 |
|---|---|
| `segment_id` | 仅用作 `:key` |
| `script_excerpt` | 中间列正文 |
| `narrative_role` | 左下角 `el-tag`（统一 `type="info"`，无角色差异化）|
| `visual_intent` | 右侧列描述 |
| `start_hint_sec` / `end_hint_sec` | 左侧列时间范围 |
| `framing_hint` | 右侧列标签 |
| `motion_hint` | 右侧列标签 |

#### 未展示（10 个 + 2 个顶层字段）

| 缺失字段 | 归属 | 重要程度 | 说明 |
|---|---|---|---|
| `scene_description` | segment | **高** | 场面描述，必填字段，是下游 asset planning 的关键输入 |
| `visual_elements` | segment | **高** | 核心视觉元素列表（人物、物体、环境等） |
| `content_type` | segment | **中** | 内容类型：live_action / text_card / map / illustration |
| `editing_hint` | segment | **中** | 剪辑手法：single / cutaway / montage |
| `on_screen_text` | segment | **中** | 画面叠加文字列表 |
| `risk_notes` | segment | **中** | 分镜风险/注意事项 |
| `order` | segment | **低** | 排序序号（内部关联字段） |
| `linked_beats` | segment | **低** | beat trace 引用（内部关联字段） |
| `linked_quotes` | segment | **低** | quote trace 引用（内部关联字段） |
| `estimated_total_duration_sec` | plan 顶层 | **中** | 规划总时长 |
| `global_visual_notes` | plan 顶层 | **中** | 全局视觉风格备注 |
| `source_script_record_id` | plan 顶层 | **低** | 内部关联字段 |
| `source_topic_package_id` | plan 顶层 | **低** | 内部关联字段 |

---

## 总体策略

三个阶段依次推进，每个阶段完成验收后再进入下一阶段。P1 会重构 P0 的展示方式（字段从三列布局迁移到折叠详情区），这是正常的 UI 迭代节奏。

---

## 阶段一：信息完整性补齐（P0）

### 目标

建立数据管线准备层——中文映射常量 + computed 属性——为 P1 的折叠详情布局提供所需的数据结构，同时尽可能在当前三列布局中补充高频字段。考虑到 P1 会立即重构布局，本阶段不追求完美渲染，重点是确保所有字段都有对应的 computed 能取到，避免 P1 实施时再回过头补数据层。

### 设计决策：数据管线 vs 渲染

| 操作 | 本阶段执行 | 推迟到 P1 | 说明 |
|---|---|---|---|
| 中文映射常量 | ✅ 在本阶段完成 | — | `narrativeRoleLabels`、`contentTypeLabels`、`editingHintLabels`、`framingHintLabels` |
| computed 属性 | ✅ 在本阶段完成 | — | 为所有缺失字段建立数据访问路径 |
| 当前布局中追加字段 | ✅ 在最轻量改动下补齐 | — | `scene_description`、`visual_elements`、`content_type`、`editing_hint`、`risk_notes`、`on_screen_text` 在现有三列布局中渲染 |
| segments header 加总时长 | ✅ 在本阶段完成 | — | `estimated_total_duration_sec` |
| `global_visual_notes` 卡片 | ✅ 在本阶段完成 | — | segments section 上方 |
| 折叠详情布局重构 | — | ✅ P1 | 重写 template 为摘要行 + 折叠详情区 |

### 涉及的缺失字段及展示策略

| 字段 | 本阶段展示策略（三列布局内） |
|---|---|
| `scene_description` | 在 segment card 右侧 visual_intent 下方增加一行场面描述 |
| `visual_elements` | 以小巧标签列表展示，放在现有 framing_hint / motion_hint 标签同行 |
| `content_type` | 新增标签，中文映射：live_action→实拍、text_card→文字卡、map→地图、illustration→插画 |
| `editing_hint` | 新增标签，中文映射：single→单镜、cutaway→切出、montage→蒙太奇 |
| `on_screen_text` | 存在时展示 "画面文字: xxx" 标签 |
| `risk_notes` | 存在时展示黄色警告区块（`el-alert` 简约版或图标+文字） |
| `estimated_total_duration_sec` | 在 "分镜段落" header 行附带 "预计总时长约 XX 秒" |
| `global_visual_notes` | 有内容时，在 segments section 上方展示一个简约全局风格备注卡片 |

### 不改的字段

`order`、`linked_beats`、`linked_quotes`、`source_script_record_id`、`source_topic_package_id`（内部关联字段，用户无需直接查看）

### 改动文件

- `frontend/src/components/storyboard/StoryboardPanel.vue`（唯一改动文件）

### 改动范围

1. 新增中文映射常量：
   - `narrativeRoleLabels`：opening→开篇 等 7 个
   - `contentTypeLabels`：live_action→实拍 等 4 个
   - `editingHintLabels`：single→单镜 等 3 个
   - `framingHintLabels`：wide→广角 等 5 个
2. 新增 computed 属性，为所有缺失字段建立数据访问路径
3. 在 template 的 segment card 中增加：
   - `scene_description` 段落
   - `visual_elements` 标签组
   - `content_type` 标签
   - `editing_hint` 标签
   - `on_screen_text` 条件展示
   - `risk_notes` 条件展示
4. 在 segments header 增加总时长展示
5. 在 segments section 上方增加 `global_visual_notes` 卡片
6. 补充相应的 scoped style

### 验证方式

- [ ] 浏览器访问分镜页面，确认每个 segment card 展示了 `scene_description`
- [ ] 确认 `visual_elements` 以标签形式出现
- [ ] 确认 `content_type` 和 `editing_hint` 标签出现（中文映射正确）
- [ ] 确认有 `risk_notes` 时显示警告区块
- [ ] 确认总时长在 header 中展示
- [ ] 确认 `global_visual_notes` 卡片出现
- [ ] 确认 UI 不崩，现有功能不受影响

---

## 阶段二：信息层次优化（P1）

### 目标

把三列等宽卡片布局改为「摘要行 + 可展开详情」模式，让用户一眼扫过所有段落，按需深入查看详情。

### 核心设计

每个 segment card 改为折叠式：

```
┌─────────────────────────────────────────────────────┐
│ #1  开篇   0s~8.2s                                    │  ← 摘要行始终可见
│     "汉武帝晚年的一次秘密召见..."                        │  ← script_excerpt 首句
│     [展开详情 ▾]                                       │
├─────────────────────────────────────────────────────┤
│ 场面描述：未央宫椒房殿内，烛火摇曳...                      │  ← 展开后可见
│ 视觉意图：用昏暗光线和人物对峙制造压迫感                     │
│                                                        │
│ 视觉元素：[汉武帝] [钩弋夫人] [椒房殿] [烛火]              │
│ 技术：实拍 · 广角 · 推进 · 单镜                          │
│ 画面文字：—                                              │
│ 风险提示：⚠ 历史场景还原依赖文字记载，细节需谨慎             │
└─────────────────────────────────────────────────────┘
```

### 折叠策略

- 默认展开前 3 段和最后 1 段（opening 和 ending 默认可见）
- 默认展开 `peak` 角色段落（高潮段默认可见）
- 其余段落默认折叠
- 提供「展开全部 / 收起全部」按钮

### 改动文件

- `frontend/src/components/storyboard/StoryboardPanel.vue`（唯一改动文件）

### 改动范围

1. 新增 `expandedSegments` 响应式 Set，管理每个 segment 的展开状态
   - **Vue 3 响应性注意**：`ref(new Set())` 的 `.add()`/`.delete()` 不会触发响应式更新
   - **正确做法**：每次变异后触发替换——
     ```ts
     const expandedSegments = ref(new Set<string>());
     function toggle(id: string) {
       const next = new Set(expandedSegments.value);
       next.has(id) ? next.delete(id) : next.add(id);
       expandedSegments.value = next;
     }
     ```
2. 新增 `isAllExpanded` / `toggleAll` 计算属性和方法
3. 调整折叠/展开机制：
   - **删除**旧的 `COLLAPSE_THRESHOLD` + `visibleSegments` + `hasMoreSegments` + `hiddenCount` + `isExpanded` 方案
   - **替换为**基于 `expandedSegments` 的按段落折叠（不再用数量阈值隐藏段落，每个段落都在 DOM 中，只是详情区可折叠）
4. 卡片 template 改为垂直布局：
   - **摘要行**（始终可见）：编号 + 叙事角色标签 + 时间 + script_excerpt（截断首句）+ 展开/折叠按钮
   - **详情区**（条件渲染）：scene_description + visual_intent + visual_elements 标签 + 技术标签行 + on_screen_text + risk_notes
5. 展开/折叠过渡动画（CSS `max-height` + `overflow: hidden` + `transition`）
6. 重写 CSS 布局（不再使用三列 grid，改用单列垂直 + flex 布局）

### 验证方式

- [ ] 浏览器确认默认展开 opening / ending / peak 段落的详情
- [ ] 确认其余段落默认折叠，可点击展开
- [ ] 确认展开全部 / 收起全部按钮功能正常
- [ ] 确认折叠/展开有过渡动画
- [ ] 确认 P0 阶段补齐的所有字段在详情区中完整展示
- [ ] 确认小屏（<820px）响应式正常

---

## 阶段三：叙事结构可视化（P2）

### 目标

让用户一眼看清分镜的叙事弧线结构，区分不同叙事角色的段落。

### 改动内容

#### 1. 叙事角色差异化样式

按 `narrative_role` 为卡片左边缘赋予不同颜色的左边框 / 指示条：

| 叙事角色 | 中文 | 边框色 | 标签色 |
|---|---|---|---|
| `opening` | 开篇 | 金色 `#c9a227` | 金色 |
| `setup` | 铺垫 | 青灰 | 默认 |
| `pressure` | 加压 | 橙黄 | 默认 |
| `turn` | 转折 | 蓝紫 | 默认 |
| `peak` | 高潮 | 橙红 `#d4713a` | 橙红 |
| `ending` | 结尾 | 暗金 `#8a7530` | 暗金 |
| `bridge` | 过渡 | 灰绿 | 默认 |

#### 2. 叙事角色中文标签优化

统一使用中文标签替代英文枚举值展示，映射关系见上表。

#### 3. 叙事弧线进度条

在 segments section 上方增加一个简约的时间轴进度条，标记各 segment 的时间位置和叙事角色：

```
开篇 ┃ 铺垫 ▏ 加压 ▏ 转折 ▏ 加压 ▏ 高潮 ▃ 结尾 ▌
0s                                                      120s
```

- 用不同颜色块填充，颜色与角色边框色一致
- hover 显示 tooltip：段落编号 + 叙事角色 + 时间范围 + script_excerpt 首句
- 纯 CSS + computed 实现，不引入额外依赖

### 改动文件

- `frontend/src/components/storyboard/StoryboardPanel.vue`（唯一改动文件）

### 改动范围

1. 新增 `roleStyleMap` 映射，为不同 `narrative_role` 提供颜色配置：
   ```ts
   { borderColor, tagType, bgColor }
   ```
2. 在 segment card 上应用动态左边框色（通过 `:style` 绑定或 CSS class）
3. 叙事角色标签应用差异化颜色（不再统一 `type="info"`）
4. 新增叙事弧线进度条渲染逻辑：
   - 根据 `segments` 数组和 `estimated_total_duration_sec` 计算每个段落的宽度比例
   - 用 `linear-gradient` 或绝对定位 `div` 渲染颜色条
   - hover tooltip 使用 `el-tooltip` 或原生 `title`
5. 补充进度条相关 CSS

### 验证方式

- [ ] 确认不同叙事角色的卡片左边框颜色不同
- [ ] 确认叙事角色标签颜色与角色对应，中文映射正确
- [ ] 确认叙事弧线进度条正确渲染所有段落，比例与时间对应
- [ ] 确认 hover 进度条各段有 tooltip 显示段落信息
- [ ] 确认进度条在小屏上表现正常

---

## 阶段间边界

| 边界 | 说明 |
|---|---|---|
| P0 → P1 | P0 完成中文映射常量 + computed + 在三列布局中补齐缺失字段；P1 重写 template 为折叠布局，P0 的所有字段会迁移到详情区，但中文映射和 computed 无需重写 |
| P1 → P2 | P2 在 P1 的卡片布局上增加左边框颜色和顶部进度条，不改变折叠逻辑。P1 的摘要行/详情区结构保持不变 |
| P0/P1/P2 与 P3 | 三个阶段都不拆分组件，所有改动在同一文件内完成，为后续 P4（组件拆分，对应前文方向 4）打下干净基础 |

## 不改什么

- 不改 store（`frontend/src/stores/storyboard.ts`）
- 不改 composables（`frontend/src/composables/useStagePolling.ts`）
- 不改后端任何代码
- 不改 schema（`shared/src/storyboard/`）
- 不改 sidebar / header / footer 组件
- 不拆分新组件文件（后续 P4 再考虑）
- 不做 Remotion / 素材 / 导出相关改动

## 改动文件汇总

三个阶段均只改动一个文件：

| 文件 | 阶段 | 改动量预估 |
|---|---|---|
| `frontend/src/components/storyboard/StoryboardPanel.vue` | P0 | +80 行（中文映射 + computed + 字段渲染 + style） |
| `frontend/src/components/storyboard/StoryboardPanel.vue` | P1 | ~重写 template 和 style（折叠布局重构），复用 P0 中文映射和 computed |
| `frontend/src/components/storyboard/StoryboardPanel.vue` | P2 | +60 行（角色样式 + 进度条） |

## 验收清单（综合）

三个阶段全部完成后，进行综合验收：

- [ ] 浏览器访问分镜页面，所有 schema 字段可见（P0）
- [ ] 折叠/展开交互流畅，过渡动画自然（P1）
- [ ] 叙事角色视觉区分清晰（P2）
- [ ] 叙事弧线进度条正确渲染，hover tooltip 正常（P2）
- [ ] 刷新页面后状态恢复正常
- [ ] 从其他阶段（选题/文案/资产）切换到分镜阶段，数据展示正常
- [ ] 从分镜页面 F5 恢复，数据展示正常
- [ ] 点击「确认分镜」按钮，流程正常进入资产阶段
- [ ] 点击「重新生成」按钮，生成中状态展示正常
- [ ] 小屏（<820px）布局不崩
- [ ] 生成中状态（`StageGenerating` 组件）不受影响
- [ ] 加载骨架屏正常
- [ ] 错误状态展示正常
- [ ] 空状态（尚未生成分镜）展示正常
