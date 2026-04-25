# UI Page Template

本目录提供页面级 UI 设计实施包模板，用于配合 [UI Design-to-Code Playbook](../../process/ui-design-to-code-playbook.md) 使用。

适用场景：

- 新页面视觉设计
- 现有页面正式重构
- 某个页面的关键状态重做，例如抽屉态、空态、有数据态

## 推荐目录结构

为每个页面建立一个独立目录，例如：

```text
docs/ui/projects/
  approved-mock.png
  annotated-spec.png
  design-spec.json
  implementation-notes.md
```

## 文件说明

- `approved-mock.png`
  - 人工审核通过的效果图
  - 是当前页面的唯一视觉基线

- `annotated-spec.png`
  - 带详细参数标注的设计图
  - 用于把视觉稿转成可编码规格

- `design-spec.json`
  - 从参数图提取出的结构化参数
  - 编码时优先消费该文件，而不是只看图片猜尺寸

- `implementation-notes.md`
  - 记录本轮 UI 落地范围、冻结点、验证方法和残余偏差

## 使用建议

1. 先复制本目录中的 `design-spec.json` 和 `implementation-notes.md`
2. 把页面名、阶段范围、参数和验证项改成当前页面实际值
3. 将通过审核的效果图和参数图放到同一页面目录
4. 编码和验收均以该目录中的产物为准

## 当前不建议

- 只放效果图，不补参数规格
- 参数已经冻结后继续在编码阶段随意改尺寸
- 不做页面目录，任由图片和参数散落在聊天记录或临时目录中
