# 2026-04-28 Open Discovery Topic Recommendation Notes

## 手动验证基线

### 失败 / 空缺检查清单

- [ ] 能定位 topic run 的 `llm-interactions` Markdown
- [ ] 能看到 recommendation seed
- [ ] 能看到最终候选与 diagnostics

### 基线 smoke 结论

- 先执行 `npm run harness:ui-acceptance:smoke` 作为手动验证基线。
- 基线结果：PASS
- 基线 run_id：`2026-04-29T09-58-43-952Z-smoke`
- 基线缺口：
  - `harness/README.md` 当时只写了 UI acceptance 输出目录，没有给出 `project_id -> short_id -> storage/projects 递归搜索` 的稳定定位链路。
  - `docs/process/ui-design-to-code-playbook.md` 当时没有要求把 smoke 产物与项目级 trace 做最小可追溯记录。
  - 旧版 notes 曾引用 unrelated topic runtime run，不能证明某次 smoke 产物真的能对应到文中的路径样例。

## 返工后 smoke 验证

- 再次执行 `npm run harness:ui-acceptance:smoke`。
- 结果：PASS
- run_id：`2026-04-29T10-17-53-560Z-smoke`
- output_dir：`D:/myproject/story-video-forge2/harness/scripts/runtime/output/ui-acceptance/2026-04-29T10-17-53-560Z-smoke`
- project_id：`edadd327-0a7a-4ab0-8cb0-4c5772e5f368`
- short_id 推导结果：`p_edadd327`

### 本次实际定位命令

```powershell
$projectId = 'edadd327-0a7a-4ab0-8cb0-4c5772e5f368'
$shortId = 'p_' + (($projectId -replace '[^a-zA-Z0-9]', '').ToLower().Substring(0, 8))
Get-ChildItem 'storage/projects' -Directory -Recurse |
  Where-Object { $_.Name -match ("\[" + [regex]::Escape($shortId) + "\]$") } |
  Select-Object FullName, LastWriteTime
```

### 本次成功路径样例

- 搜索命中项目目录：
  `D:/myproject/story-video-forge2/storage/projects/2026-04-29/商鞅变法与秦国崛起 [p_edadd327]`
- 项目级 trace 根目录：
  `D:/myproject/story-video-forge2/storage/projects/2026-04-29/商鞅变法与秦国崛起 [p_edadd327]/trace`
- topic run 目录：
  `D:/myproject/story-video-forge2/storage/projects/2026-04-29/商鞅变法与秦国崛起 [p_edadd327]/trace/topic-runs/topic_run_b5c832c2-2926-4619-94b0-189795ec9d09`
- script run 目录：
  `D:/myproject/story-video-forge2/storage/projects/2026-04-29/商鞅变法与秦国崛起 [p_edadd327]/trace/script-runs/script_run_f1fa6407`
- topic run 已确认文件：
  - `graph-trace-summary.json`
  - `runtime-diagnostics.json`
- script run 已确认文件：
  - `graph-trace-summary.json`
  - `runtime-diagnostics.json`

### 本次验证结论

- 新文档里的 `project_id -> short_id -> storage/projects 递归搜索` 路径推导方式可用，不依赖人工先知道 storage 日期。
- 本文成功路径样例与 `2026-04-29T10-17-53-560Z-smoke` 完全一致，不再引用 unrelated 旧 run。
- 本次 smoke 对应项目 trace 里实际落盘的是 `graph-trace-summary.json` 与 `runtime-diagnostics.json`。
- 本次 smoke 对应项目 trace 里未看到 `llm-interactions/*.md` 或 `recommendation-diagnostics.md`；因此 `README` 现将这两类文件表述为“当对应 topic run 已落盘交互日志时继续检查”的附加巡检目标，而不是把 UI smoke 说成必然包含它们。
