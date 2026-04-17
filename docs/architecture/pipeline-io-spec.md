# 流水线阶段输入输出规范

本文档记录当前已经确认的阶段输入输出。

## 1. 主题阶段

### 1.1 启动输入

输入：

- 项目基础设置
- `Project Style Pack`
- 用户当前主题页选择的入口与筛选偏好
- Recent Memory
- Event Registry
- Candidate Cache

输出：

- 原始候选事件/讲法集合

### 1.2 事件识别或开放发现

输入：

- 推荐入口：用户偏好 + Recent Memory + 开放发现
- 事件库入口：用户选中的 event
- 自定义入口：用户原始输入

输出：

- 规范化候选事件语义

### 1.3 Event Registry 归一化

输入：

- 候选事件语义
- Event Registry

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
- Recent Memory
- Event Registry
- Candidate Cache

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

### 2.4 本地硬校验

输入：

- `Script Input Bundle`
- `Script Draft Package`

输出：

- `pass`
- 或一次重生触发
- 或 fail

### 2.5 单一语义审校

输入：

- `Script Input Bundle`
- `Script Draft Package`

输出：

- `pass`
- `patch_once`
- `regen_once`
- `return_topic`

## 3. 后续阶段

`TBD`

- storyboard 阶段输入输出
- asset planning 阶段输入输出
- assets 阶段输入输出
- compose 阶段输入输出
