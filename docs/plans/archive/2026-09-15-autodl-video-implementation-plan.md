# AutoDL H3 视频接入实施计划

目标：用户在现有设置中选择AutoDL H3，运行按快照调用并形成可用视频资产。
架构：新增独立媒体适配器，复用目录、配置、运行快照、资产与成本合同。
技术栈：TypeScript、Vue、Vitest、Node fetch、ffprobe。

- [x] 任务1：目录与readiness。修改pricing-catalog.seed.ts、generation-cost-bootstrap.ts、generation-capability-readiness.ts；新增tests/backend/config/autodl-catalog.test.ts。验证独立凭据、默认不变、质量与价格后中文提交。
- [x] 任务2：新增providers/autodl/autodl-image-to-video-provider.ts及协议测试，接入assets-run.service.ts。验证异步状态、分段、原图、时长、下载与快照隔离后中文提交。
- [x] 任务3：检查计费计量与设置质量标签；增加设置选择回归，安全配置本地.env；运行相关最小测试与构建。
- [x] 任务4：真实浏览器验证设置选择与持久化，记录已验证/未验证和已知人声限制；自审后提交并归档计划。

验证命令：npx vitest run --configLoader runner <相关测试文件> --no-file-parallelism；npm run typecheck:backend；npm run build:frontend。测试不发起真实付费请求。不得改动已有无关工作区文件。

验收证据：`docs/records/2026-09-15-autodl-video-integration.md`。集成后未新增付费生成；真实媒体回放与协议测试的验证范围见记录。
