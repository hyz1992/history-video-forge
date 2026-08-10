# 计划状态治理收口实施计划

> **供 agentic workers 使用：**执行本计划必须使用 `superpowers:subagent-driven-development`（有 subagent 时）或 `superpowers:executing-plans`。所有步骤使用复选框跟踪。

**目标：**将 `docs/plans/` 根目录中的历史计划完整归档，校准当前状态入口，并保证历史证据与本地 Markdown 链接可追溯。

**架构：**本任务只做文档治理。先冻结移动前的文件与断链基线，再以 Git rename 归档全部非 README 计划；只机械调整路径，不改写历史结论；最后重写当前 plans 入口并同步 `docs/README.md` 与路线图。

**技术栈：**Markdown、Git、PowerShell、本地文件系统检查。

---

## 执行前提

本实施计划必须先通过审查并以中文独立提交，随后才能开始 Chunk 1。执行开始时运行：

```powershell
$trackedPlans = @(git ls-files 'docs/plans/2026-*.md')
if ($trackedPlans.Count -ne 107) { throw "tracked_plan_count_mismatch:$($trackedPlans.Count)" }
$trackedPlans | ForEach-Object { git ls-files --error-unmatch -- $_ | Out-Null }
```

预期：107 份非 README 计划全部已跟踪；任何文件未跟踪都必须先停止，不得进入移动。

## 文件职责图

| 文件或目录 | 职责 |
| --- | --- |
| `docs/plans/README.md` | 唯一当前计划入口；本次重写为简洁状态说明 |
| `docs/plans/archive/` | 保存全部历史设计与实施证据，不作为当前执行入口 |
| `docs/README.md` | 项目文档总入口；将旧 V2 草案降级为历史输入 |
| `docs/todos/roadmap-todo.md` | 当前任务优先级与剩余风险 |
| `docs/architecture/api-design.md` | 更新指向 S2-5 历史设计的归档链接 |
| `docs/architecture/script-validation-spec.md` | 更新指向文本归一化历史设计的归档链接 |
| `harness/docs/s2-0-baseline-protocol.md` | 更新指向 S2-0 历史设计与实施计划的归档链接 |
| `docs/records/*.md` | 只机械更新明确指向原 plans 根目录的历史引用 |
| `docs/plans/2026-08-11-plan-state-governance-closeout-design.md` | 本任务已批准设计；最终随实施计划一起归档 |
| `docs/plans/2026-08-11-plan-state-governance-closeout-implementation-plan.md` | 本执行清单；完成后归档 |

## Chunk 1：冻结基线与归档文件

### Task 1：记录移动前文件和链接基线

**文件：**

- 只读：`docs/plans/*.md`
- 只读：仓库内全部 `*.md`

- [ ] **Step 1：确认用户文件边界**

运行：

```powershell
git status --short
```

预期：除本任务文档外，仍只有用户原有的 `_tmp_classify.mjs` 与 `scripts/migrate-uuid-storage-to-date.mjs` 未跟踪；不得修改或 stage 它们。

- [ ] **Step 2：冻结计划文件清单**

运行：

```powershell
$files = Get-ChildItem docs/plans -File -Filter '*.md' | Where-Object Name -ne README.md | Sort-Object Name
$files.Count
$files | Select-Object -ExpandProperty Name
$collisions = @($files | Where-Object { Test-Path (Join-Path 'docs/plans/archive' $_.Name) })
if ($collisions.Count -gt 0) { throw "archive_name_collision:$($collisions.Name -join ',')" }
[IO.File]::WriteAllLines(
  "$env:TEMP\history-video-forge-plan-files-before.txt",
  [string[]]$files.Name,
  [Text.UTF8Encoding]::new($false)
)
```

预期：实施开始时为原有 105 份历史计划，加本任务设计与实施计划，共 107 份；`docs/plans/archive/` 中不存在同名目标。

- [ ] **Step 3：记录移动前 Markdown 断链基线**

运行以下 PowerShell。扫描器跳过 fenced code、行内 code、`http(s)`、`mailto:`、`file:` 与纯锚点；对即将移动的 107 份 source 预先归一成归档后的逻辑路径，因此移动前后可以直接比较：

```powershell
function Get-MarkdownBrokenLinks([bool]$AfterMove) {
  $repo = (Resolve-Path '.').Path
  $issues = [System.Collections.Generic.List[string]]::new()
  $markdownFiles = @(git ls-files -- '*.md')
  $markdownFiles | ForEach-Object {
      $file = Get-Item -LiteralPath $_ -ErrorAction Stop
      $inFence = $false
      $relativeSource = [IO.Path]::GetRelativePath($repo, $file.FullName).Replace('\', '/')
      $logicalSource = if (-not $AfterMove -and $relativeSource -match '^docs/plans/2026-') {
        $relativeSource.Replace('docs/plans/', 'docs/plans/archive/')
      } else { $relativeSource }
      $lineNo = 0
      foreach ($line in [IO.File]::ReadAllLines($file.FullName)) {
        $lineNo++
        if ($line.TrimStart().StartsWith('```')) { $inFence = -not $inFence; continue }
        if ($inFence) { continue }
        foreach ($match in [regex]::Matches($line, '!?\[[^\]]*\]\((?<target>[^)]+)\)')) {
          $before = $line.Substring(0, $match.Index)
          if (([regex]::Matches($before, '(?<!`)`(?!`)').Count % 2) -eq 1) { continue }
          $target = $match.Groups['target'].Value.Trim().Trim('<', '>')
          $target = ($target -split '#', 2)[0]
          if (-not $target -or $target -match '^(https?:|mailto:|file:|#)') { continue }
          $candidate = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $target))
          if (-not (Test-Path -LiteralPath $candidate)) {
            $logicalTarget = [IO.Path]::GetRelativePath($repo, $candidate).Replace('\', '/')
            $issues.Add("$logicalSource|$logicalTarget")
          }
        }
      }
    }
  return @($issues | Sort-Object -Unique)
}
$baseline = Get-MarkdownBrokenLinks $false
[IO.File]::WriteAllLines(
  "$env:TEMP\history-video-forge-broken-links-before.txt",
  [string[]]$baseline,
  [Text.UTF8Encoding]::new($false)
)
"BROKEN_BASELINE_COUNT=$($baseline.Count)"
```

预期：命令成功并写入稳定基线；后续硬断言只允许集合减少或保持，不允许新增。

### Task 2：以 Git rename 归档全部非 README 计划

**文件：**

- Move：`docs/plans/2026-*.md` → `docs/plans/archive/2026-*.md`

- [ ] **Step 1：再次检查目标边界**

运行：

```powershell
$repoRoot = (Resolve-Path '.').Path
$sourceRoot = (Resolve-Path docs/plans).Path
$archiveRoot = (Resolve-Path docs/plans/archive).Path
if (-not $sourceRoot.StartsWith($repoRoot) -or -not $archiveRoot.StartsWith($sourceRoot)) {
  throw 'plan_archive_boundary_invalid'
}
$sourceRoot
$archiveRoot
```

预期：二者都位于当前仓库的 `docs/plans/` 下，且 archive 不是仓库根或用户目录。

- [ ] **Step 2：逐文件执行可追溯移动**

对 `docs/plans/README.md` 之外、已经由执行前提证明 tracked 的 107 份 Markdown 文件逐一运行：

```powershell
git mv -- docs/plans/<文件名> docs/plans/archive/<文件名>
```

预期：无覆盖、无删除，Git 将大部分变更识别为 rename。

- [ ] **Step 3：验证文件守恒**

运行：

```powershell
$before = Get-Content -Encoding utf8 "$env:TEMP\history-video-forge-plan-files-before.txt"
$rootFiles = @(Get-ChildItem docs/plans -File -Filter '*.md')
$archivedNames = @(Get-ChildItem docs/plans/archive -File -Filter '*.md' | Select-Object -ExpandProperty Name)
$missing = @(Compare-Object $before $archivedNames | Where-Object SideIndicator -eq '<=')
if ($rootFiles.Count -ne 1 -or $rootFiles[0].Name -ne 'README.md' -or $missing.Count -gt 0) {
  throw 'plan_file_conservation_failed'
}
```

预期：根目录只剩 `README.md`；移动前 107 个精确文件名全部存在于 archive，没有遗漏。

## Chunk 2：机械修复历史链接

### Task 3：调整归档文件内部的相对链接

**文件：**

- Modify：`docs/plans/archive/2026-*.md`

- [ ] **Step 1：列出受目录层级影响的链接模式**

运行：

```powershell
rg -n '\]\((\.\./|\.\./\.\./|\./archive/)' docs/plans/archive -g '2026-*.md'
```

预期：主要为 `../records/`、`../architecture/`、`../data/`、`../operations/`、`../superpowers/`、`../plans/README.md`、`../../docs/`、`../../harness/`、`../../backend/`、`../../frontend/` 与 `../../AGENTS.md`。

- [ ] **Step 2：只用 `apply_patch` 重定向真实 Markdown destination**

禁止全文 Replace、格式化器或脚本批量写回。根据 Step 1 的 `rg` 输出逐个检查真实 Markdown 链接，只对链接 destination 使用 `apply_patch`。跳过 fenced code、行内 code 和本实施计划中的规则示例。

允许的 destination 映射为：

- `../records/` → `../../records/`
- `../architecture/` → `../../architecture/`
- `../data/` → `../../data/`
- `../todos/` → `../../todos/`
- `../requirements/` → `../../requirements/`
- `../ui/` → `../../ui/`
- `../standards/` → `../../standards/`
- `../process/` → `../../process/`
- `../migration/` → `../../migration/`
- `../operations/` → `../../operations/`
- `../superpowers/` → `../../superpowers/`
- `../plans/README.md` → `../README.md`
- `./README.md` → `../README.md`
- `../../docs/` → `../../../docs/`
- `../../harness/` → `../../../harness/`
- `../../backend/` → `../../../backend/`
- `../../frontend/` → `../../../frontend/`
- `../../shared/` → `../../../shared/`
- `../../prompts/` → `../../../prompts/`
- `../../tests/` → `../../../tests/`
- `../../AGENTS.md` → `../../../AGENTS.md`

另单独把实际历史链接 `file:///d:/ai_learn/history-video-forge/docs/plans/2026-06-21-landing-page-1-to-1-porting-plan.md` 指向相同文件名的 archive 路径。除此之外不得修改 `file:` URL，不得修改正文、复选框、提交 ID、运行结论或代码示例。

- [ ] **Step 3：检查未覆盖的相对链接**

重新运行 Step 1，并逐项解析剩余模式；同时运行 Task 1 Step 3 的扫描器检查 archive 文件。只用 `apply_patch` 补充确有目录层级变化的真实 destination。

### Task 4：修复归档目录外部的引用

**文件：**

- Modify：`docs/architecture/api-design.md`
- Modify：`docs/architecture/script-validation-spec.md`
- Modify：`harness/docs/s2-0-baseline-protocol.md`
- Modify：`docs/records/2026-05-17-project-status-for-claude-review.md`
- Modify：`docs/records/2026-05-17-compose-stage-completion-checklist.md`
- Modify：`docs/records/2026-07-12-trae-v2-handoff.md`
- Modify：`docs/todos/roadmap-todo.md`

- [ ] **Step 1：找出全部原根目录引用**

运行：

```powershell
rg -n -g '*.md' 'docs/plans/2026-|\.\.?/plans/2026-|\]\(\.\.?/2026-' . --glob '!docs/plans/**' --glob '!node_modules/**' --glob '!.git/**'
```

预期：得到明确、有限的外部引用列表。

- [ ] **Step 2：使用 `apply_patch` 更新引用**

把每个原 `docs/plans/2026-*` 目标改为 `docs/plans/archive/2026-*`；相对路径按来源文件目录调整。纯文本路径也同步更新，历史结论不变。

- [ ] **Step 3：确认原引用清零**

重新运行 Step 1。预期：除描述“原路径已不存在”的历史句子外，没有指向根目录历史文件的当前链接或路径。

## Chunk 3：校准当前状态入口

### Task 5：重写 Plans 当前入口

**文件：**

- Modify：`docs/plans/README.md`

- [ ] **Step 1：用简洁中文入口替换历史流水账**

README 只保留：

1. 根目录与 archive 的用途。
2. 截至 2026-08-11 的当前状态。
3. Asset Planning 正常路径 live 已验证、global normalization/repair 异常分支未触发的精确边界。
4. 当前推荐任务：前端 v1 六步真实浏览器验收矩阵。
5. `S2-2` 等后续任务必须新建当日中文 design + implementation plan。
6. 正式入口与 archive 追溯链接。

- [ ] **Step 2：检查 README 不再把 archive 当执行入口**

运行：

```powershell
rg -n '继续执行|当前设计草案|等待实施|下一执行入口' docs/plans/README.md
```

预期：不存在鼓励从 archive 续跑的表述。

### Task 6：同步项目总入口与路线图

**文件：**

- Modify：`docs/README.md`
- Modify：`docs/todos/roadmap-todo.md`

- [ ] **Step 1：降级旧 V2 草案**

在 `docs/README.md` 中把 2026-07-13 V2 草案明确标为历史输入；删除“进入后续 V2 功能前的当前审查入口”语义；注明 `S2-2` 等新任务必须结合正式架构、当前代码和实际验证新建设计与实施计划。

- [ ] **Step 2：完成路线图治理项**

将“收口当前未归档计划”标记为完成；保留前端 v1 浏览器验收矩阵为进行中；在剩余风险中记录 global 异常恢复分支只有 non-live 证据，不自动升级为付费 live 任务。

- [ ] **Step 3：交叉检查三个入口**

运行：

```powershell
rg -n '前端 v1|S2-2|archive|global.*repair|未归档计划' docs/README.md docs/plans/README.md docs/todos/roadmap-todo.md
```

预期：三个入口优先级一致，无互相冲突。

## Chunk 4：验证、审查与提交

### Task 7：运行完整文档验证

**文件：**

- Verify：全部本次变更

- [ ] **Step 1：比较断链基线**

原样重新定义 Task 1 Step 3 的 `Get-MarkdownBrokenLinks`，然后运行：

```powershell
$baseline = @(Get-Content -Encoding utf8 "$env:TEMP\history-video-forge-broken-links-before.txt")
$post = Get-MarkdownBrokenLinks $true
$newBroken = @(Compare-Object $baseline $post | Where-Object SideIndicator -eq '=>')
if ($newBroken.Count -gt 0) {
  $newBroken | Format-Table -AutoSize
  throw "new_markdown_broken_links:$($newBroken.Count)"
}
"BROKEN_POST_COUNT=$($post.Count)"
```

预期：硬断言通过；移动后断链集合不比按归档后 source 路径归一化的移动前基线增加。若新增，必须逐项修复后重跑。

- [ ] **Step 2：验证文件守恒与根目录边界**

运行：

```powershell
$rootPlans = @(Get-ChildItem docs/plans -File -Filter '*.md')
if ($rootPlans.Count -ne 1 -or $rootPlans[0].Name -ne 'README.md') { throw 'plans_root_not_clean' }
git diff --summary
```

预期：根目录只有 `README.md`；107 份文件均进入 archive；没有意外删除或覆盖。

- [ ] **Step 3：验证文本与 Git diff**

运行：

```powershell
git diff --check
git status --short
git diff --stat
```

预期：`git diff --check` exit 0；状态只包含本任务文档移动、链接与状态入口修改，以及两个未跟踪用户脚本。

- [ ] **Step 4：按原始请求自审**

逐项标记：

- 已修：历史计划归档。
- 已修：Plans 当前入口校准。
- 已修：旧 V2 草案降级。
- 已修：Asset Planning live/non-live 证据边界。
- 已修：路线图治理项。
- 已验证：无新增本地 Markdown 断链。
- 未改：业务代码、Prompt、schema、API、测试、storage、付费 provider 与用户未跟踪脚本。

### Task 8：中文提交并归档本计划

**文件：**

- Stage：本任务全部已验证文件

- [ ] **Step 1：暂存精确文件集合**

运行精确 pathspec：

```powershell
git add -A -- docs/plans docs/README.md docs/todos/roadmap-todo.md `
  docs/architecture/api-design.md docs/architecture/script-validation-spec.md `
  docs/records/2026-05-17-project-status-for-claude-review.md `
  docs/records/2026-05-17-compose-stage-completion-checklist.md `
  docs/records/2026-07-12-trae-v2-handoff.md `
  harness/docs/s2-0-baseline-protocol.md
```

不得使用 `git add .`、`git add -A`（无 pathspec）或会包含用户未跟踪脚本的宽泛命令。

- [ ] **Step 2：检查暂存区**

运行：

```powershell
git diff --cached --check
git diff --cached --stat
git status --short
$cached = @(git diff --cached --name-only)
$unexpected = @($cached | Where-Object {
  $_ -notmatch '^docs/plans/' -and
  $_ -notin @(
    'docs/README.md',
    'docs/todos/roadmap-todo.md',
    'docs/architecture/api-design.md',
    'docs/architecture/script-validation-spec.md',
    'docs/records/2026-05-17-project-status-for-claude-review.md',
    'docs/records/2026-05-17-compose-stage-completion-checklist.md',
    'docs/records/2026-07-12-trae-v2-handoff.md',
    'harness/docs/s2-0-baseline-protocol.md'
  )
})
if ($unexpected.Count -gt 0) { throw "unexpected_staged_paths:$($unexpected -join ',')" }
$userCached = @(git diff --cached --name-only -- _tmp_classify.mjs scripts/migrate-uuid-storage-to-date.mjs)
if ($userCached.Count -gt 0) { throw 'user_untracked_files_staged' }
$userStatus = @(git status --short -- _tmp_classify.mjs scripts/migrate-uuid-storage-to-date.mjs)
if ($userStatus.Count -ne 2 -or @($userStatus | Where-Object { $_ -notmatch '^\?\? ' }).Count -gt 0) {
  throw 'user_untracked_file_status_changed'
}
```

预期：allowlist 硬断言通过；两个用户脚本仍分别显示 `??`，暂存区不包含业务代码或 storage。

- [ ] **Step 3：中文提交**

运行：

```powershell
git commit -m "收口历史计划与当前状态入口"
```

预期：提交成功，提交只表达一个文档治理问题。

- [ ] **Step 4：提交后复核**

运行：

```powershell
git status --short
git log -3 --oneline
```

预期：只剩两个用户原有未跟踪脚本；最近提交依次包含治理设计、治理实施计划和最终收口提交。
