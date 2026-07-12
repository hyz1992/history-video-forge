# V2 第三批聚合切换风险基线

日期：2026-07-12

范围：AssetManifest、AssetProviderJob、Compose、RenderJob、PublishPackage。

## 当前事实

五类对象已有 Prisma schema，但生产运行时仍以 `DbClient` 的 Map 为唯一读写面；启动 hydration 只覆盖前两批聚合。各 repository 的 save/update 只修改 Map，ProviderJob 同样无法跨重启恢复。

## 高风险项

### 1. generating record 提前覆盖 active

- Assets 在 provider 执行前把 generating manifest 设为 active；stale source 时删除 generating record 并把 active 清空。
- Compose 在 timeline build 前把 placeholder 设为 active；stale source 时清空 active。
- Render 在 adapter 输出文件前把 rendering job 设为 active；失败或 stale source 时可能让旧可用 render 失去可信入口。
- Publish 在包内容完成前把 generating package 设为 active。

这与第二批已经冻结的语义冲突：历史/generating record 可以保存，但只有最终合格记录能替换 active；失败必须保留上一条有效 active。

### 2. 跨项目链缺少数据库事务校验

当前逻辑主要依靠内存对象和 active 指针顺序，没有在提交 active 时统一验证：

`Project -> Topic -> Script -> Storyboard -> AssetPlan -> AssetManifest -> Compose -> Render -> Publish`

任一来源记录来自其他项目时，必须在同一事务拒绝，不能只依赖调用方已查过。

### 3. 文件与数据库缺少明确提交协议

- assets file storage、手动上传、publish cover 和 fake render 会先写或复制最终路径，再更新 Map record。
- cover generation 直接 `writeFile` 到最终路径；cover copy 直接 `copyFile` 到最终路径。
- render adapter 产出完成后才更新 RenderJob；数据库失败时缺少统一、可识别的 staging 状态。

第三批切换不能把 Map save 简单替换为 Prisma upsert。最低要求是：临时路径写入、文件校验、原子移动、数据库登记；若数据库登记失败，保留带 run/job id 的 staging 供恢复或清理，不删除旧 active 文件和记录。

### 4. ProviderJob 恢复语义尚未接入

ProviderJob schema 已有唯一键 `(assetRunId, executionId, taskId, attemptCount)`，适合作为幂等边界；但当前 create/update/list 只读写 Map。重启后 submitted/polling job 消失，可能造成重复供应商调用或无法继续轮询。

### 5. Publish 是多次原地更新，不只是一次生成

标题、描述、封面上传/生成、包更新都会覆盖同一个 active PublishPackageRecord。writer 必须支持 revision/upsert，同时保证 package 的 Render、Topic、Script、Storyboard、AssetManifest 全链归属一致。封面写入还会改 AssetManifest，不能把 Publish 当成单表孤立切换。

## 推荐实施顺序

1. 建立第三批 hydration parity：五类 record/job 全量 JSON/date 往返，按 owner 项目隔离。
2. 接入 save-only writer：历史和 generating record 入库但不切 active；ProviderJob create/update 使用数据库唯一键保证幂等。
3. 逐阶段实现 activation transaction：AssetManifest -> Compose -> Render -> Publish，并冻结失败保留旧 active。
4. 单独收口文件提交协议，先覆盖 assets artifact、render output、publish cover 三类最终文件。
5. 覆盖 ProviderJob 中断恢复、render 完成记录、publish 多次更新和全链跨项目负向测试。
6. 最后用隔离数据库、真实文件 fixture 和内置浏览器完成刷新/重启/深链验收。

## 当前闸门

在 hydration parity 与文件提交协议测试建立前，不直接修改第三批 run service 的 active 指针顺序；否则容易同时引入数据丢失和孤儿文件问题。

## Hydration parity 实施结果

已新增第三批启动 hydration：按第一批已加载的 owner 项目 ID 恢复 AssetManifest、Compose、RenderJob、PublishPackage；ProviderJob 只按这些 AssetManifest ID 恢复，不会加载其他 owner 的供应商任务。

专项真实 SQLite fixture 覆盖五类记录的 JSON sidecar、Render 状态与输出 artifact、ProviderJob request/response 和提交/轮询时间，并创建另一 owner 的完整下游链验证隔离。数据库/服务矩阵结果为 18 个测试文件、62 项测试通过；后端类型检查与构建通过。
