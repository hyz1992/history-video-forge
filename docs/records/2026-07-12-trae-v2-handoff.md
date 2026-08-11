# Trae V2 开发交接说明

## 交接边界

基础设施收口已经完成。Trae 可以从正式 V2 产品功能开始，不需要继续重做 Prisma 迁移、JSON persistence、ProviderJob 恢复或 V1 风险止血。

## 开发前必读

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/requirements/product-requirements.md`
4. `docs/data/schema-design.md`
5. `docs/architecture/pipeline-io-spec.md`
6. `docs/plans/archive/2026-07-11-v2-data-foundation-closeout-implementation-plan.md`
7. `docs/records/2026-07-12-v2-data-foundation-closeout-verification.md`

## 不可破坏的基础合同

- 正式启动只使用 Prisma；不得恢复生产 JSON 写入或空 Map 降级。
- 每个项目必须有 owner；当前 migration owner 只是过渡身份。
- active pointer 更新与对应 record 保存必须保持事务语义，失败不得覆盖旧 active。
- 媒体文件不进入数据库；继续使用稳定相对 URI、存在性检查和 staging 补偿协议。
- ProviderJob 使用 `(assetRunId, executionId, taskId, attemptCount)` 幂等键；重启不得盲目重提外部任务。
- 测试不得写真实 `storage/projects` 或 `storage/topic-candidate-library`。

## 建议的 V2 开发顺序

1. 用户系统与管理员 RBAC 设计审查。
2. 项目 owner/成员访问边界和迁移 owner 转换方案。
3. 选题筛选配置、事件库与自定义选题合同。
4. 用户偏好与视频成本策略。
5. Prompt 代码资产治理和模型调用性能优化。
6. 内容策略配置化；历史故事达到合格线后再考虑神话等相似故事模式。

正式 V2 主要由 Trae 实现；涉及 Prisma schema、管理员权限、内容策略抽象、ProviderJob 或文件提交协议的重大设计，先提交设计文档进行独立审查。

## 验证命令

```powershell
npm run typecheck:backend
npm run build
npm run test:partitions
$env:DATABASE_URL = "file:./storage/history-video-forge.db"
node --import tsx backend/src/cli/database-operations.ts status
```

浏览器重点路由：

- `/projects`
- `/projects/:projectId/topic`
- `/projects/:projectId/script`
- `/projects/:projectId/storyboard`
- `/projects/:projectId/asset`
- `/projects/:projectId/compose-render`
- `/projects/:projectId/publish`
