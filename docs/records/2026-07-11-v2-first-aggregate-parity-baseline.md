# V2 第一批聚合 parity 基线记录

日期：2026-07-11

## 已验证范围

新增 Prisma hydration 读模型，可从独立数据库重建以下运行时领域对象：

- Project，包括 active pointers、trace JSON 和由稳定 storageKey 派生的运行时目录。
- Event Registry，包括别名、锚句和意图。
- Topic Package 的完整结构化字段。
- Candidate Cache 的当前已入库字段。
- Recommendation Round/Exposure 与项目轮次计数。

聚焦 parity 测试使用真实 baseline SQLite 和 Prisma client，验证上述对象字段及目录派生结果。

## 新发现的阻断项

当前 Candidate Cache 没有保存候选确认所需的 `sourceHint`、`recentUsageHint`、`whyThisNow` 和 `riskHints`。Recommendation Exposure 只保存 event/title/fingerprint，因此服务重启后无法无损重建 `StoredTopicCandidate`。填空字符串虽然能让代码运行，但会改变确认后的 Topic Package 与用户看到的推荐语义，不满足 parity 闸门。

## 后续实施约束

1. 在 Task 8.5-7 下一子步新增 migration `0002`，为 Candidate Cache 补齐候选卡恢复字段；不再改写 `0001_v2_baseline`。
2. hydration 必须通过 `(projectId, fingerprint)` 将 Exposure 与 Cache 关联，恢复 candidateId、轮次和完整候选字段。
3. 认证系统尚未实现期间，只接受显式 `LOCAL_PROJECT_OWNER_ID`，且启动时验证该用户存在并启用；不得隐式选择管理员或创建默认账号。
4. parity/hydration 闸门通过前，不接入真实 HTTP writer，不关闭 JSON writer。

## 0002 处理结果

已新增 `0002_candidate_card_recovery`，补齐 `sourceHint`、`recentUsageHint`、`whyThisNow` 和 `riskHintsJson`。Recommendation Exposure 通过 `(projectId, fingerprint)` 与 Candidate Cache 联合，现可恢复 candidateId、轮次与完整 `StoredTopicCandidate`，不再使用空值降级。

测试建库工具同步改为按名称顺序应用全部 migration；数据库/服务矩阵 14 个文件、57 项通过，后端类型检查与构建通过。下一步允许进入显式 owner 作用域与真实 writer 切换。
