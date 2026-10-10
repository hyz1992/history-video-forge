# history-video-forge

面向历史故事短视频的 AI 生成系统，提供选题、口播文案、分镜、素材生成、合成渲染和发布包交付工作区。

核对日期：**2026-10-10**。项目状态见 [文档索引](docs/README.md)，待办见 [路线图](docs/todos/roadmap-todo.md)，验证入口见 [Harness README](harness/README.md)。

## 当前主流程

```text
选题（系统推荐 / 事件库 / 自定义）→ 确认 Topic Package
→ 生成文案 → 确认正文 → 生成口播 → 确认口播
→ 分镜 → 资产规划与生成 → 合成渲染 → 发布包与文件导出
```

- 前端工作区为六步；口播位于文案页，资产规划位于资产页，合成与渲染合并展示。
- 新项目统一使用 `narration_first_v1`：供应商原生词级时间戳决定字幕和镜头时间。旧 `legacy_estimated` 项目保留读取、导出和显式升级入口。
- 用户登录、管理员管理、owner 隔离、生成配置快照和项目费用清单已接入。
- 默认资产规划为 `intent_compiler`；角色定妆参考图默认开启，满足出场阈值时生成，并在支持参考图的模型上注入分镜图。
- 发布交付支持封面、标题、描述、标签和文件导出；真实平台发布与人工审稿流程仍待设计。

实现已接通不代表成片质量已整体通过。口播 A8 整片验收、跨镜状态连续性等缺口见 [路线图](docs/todos/roadmap-todo.md)。semantic reviewer 保持 shadow-only。

## 本地启动

在仓库根目录执行。当前锁定的 Vite/Prisma 依赖要求 Node.js **20.19+（20.x）、22.12+（22.x）或 24+**，使用 npm workspaces；一键开发启动另需 Python 3。

```powershell
npm ci
Copy-Item .env.example .env
```

已有 `.env` 时直接编辑。主要配置：

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL` | SQLite 主数据库；建议绝对 `file:` 路径，避免根目录和 backend 工作目录解析不一致 |
| `LOCAL_PROJECT_OWNER_ID` | 启动仓储使用的 ACTIVE owner ID；迁移 owner 不能登录 |
| `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` | 核心/轻量任务路由；示例均为 `deepseek:deepseek-v4-flash` |
| `LLM_PROVIDER_*_API_KEY` | 与 [供应商注册表](backend/providers.json) 的 `apiKeyEnv` 对应 |
| `ALIYUN_DASHSCOPE_API_KEY` | 实际口播、图片与 DashScope 视频生成凭据 |
| `AUTODL_COMFYUI_TOKEN` | 配置后提供 AutoDL H3 视频候选 |

模型与音色受服务端目录、项目冻结配置及资格策略约束。新项目口播使用合格的 `qwen-audio-3.0-tts-plus` / 龙翼暮凌组合；`ALIYUN_DASHSCOPE_TTS_MODEL` 用于 assets legacy 链路。图片示例默认 `wan2.7-image`。修改用户默认不会自动改写已有项目。

### 首次初始化空数据库

仅用于全新数据库。CLI 从当前进程读取 `DATABASE_URL`，不负责加载 `.env`；完成后将同一路径与 owner ID 写入 `.env`。

```powershell
$env:DATABASE_URL = 'file:' + ((Join-Path (Get-Location).Path 'storage/history-video-forge.db') -replace '\\', '/')
$env:LOCAL_PROJECT_OWNER_ID = 'local-migration-owner'
npx tsx backend/src/cli/database-operations.ts init --confirm
npx tsx backend/src/cli/database-operations.ts owner-init --id local-migration-owner --username migration-owner --confirm
npx tsx backend/src/cli/database-operations.ts activate --mode fresh --confirm
npx tsx backend/src/cli/database-operations.ts admin-bootstrap --username admin --password '<替换为符合密码策略的密码>' --confirm
npx tsx backend/src/cli/database-operations.ts status
```

已有数据库按部署指南检查迁移与激活状态；旧 JSON 数据须走导入、校验和 `legacy_import` 激活流程，见 [数据映射](docs/data/v2-domain-model-mapping.md)。

### 开发服务

```powershell
python dev_start.py
```

默认先在 backend 目录执行 Prisma Client 生成与 `migrate deploy`，成功后启动前后端；此步骤不代替首次 owner 创建和数据库激活。`--skip-db-prepare` 可跳过数据库准备。

也可在两个终端分别执行：

```powershell
npm run dev:backend
npm run dev:frontend
```

前端默认 [127.0.0.1:5173](http://127.0.0.1:5173)，后端默认 [127.0.0.1:3000](http://127.0.0.1:3000)。`/healthz` 表示存活，`/readyz` 检查数据库迁移、激活和存储就绪。登录后进入工作区；管理员可在管理后台创建普通用户。

### 构建与部署

```powershell
npm run build
npm start
```

生产服务托管 `frontend/dist`，使用后端单端口；数据库须先准备完成。生产会话 Cookie 使用 `Secure`，远程部署需要 HTTPS。备份、迁移与 Windows 服务说明见 [部署指南](DEPLOY_WINDOWS_SERVER.md)。

## 常用验证

```powershell
npx tsx harness/scripts/run-fast-checks.ts
npm run harness:check-prompts
npm run harness:narration-first-runtime-smoke
npm run harness:assets-character-sheet-smoke
```

指定范围测试使用 `npx vitest run --configLoader runner <测试路径> --no-file-parallelism`；全量分区入口为 `npm run test:partitions`，后端类型检查为 `npm run typecheck:backend`，前端构建为 `npm run build:frontend`。前端构建不等于 TS 类型检查。fast-checks 只检查关键文件、prompt 元数据及文档命名，不证明全部文档与行为一致。

真实模型、媒体 provider、浏览器和 Remotion 验收须按 [harness 说明](harness/README.md) 显式运行并记录证据。

## 目录

| 目录 | 职责 |
| --- | --- |
| `backend/` | HTTP 服务、流水线、供应商适配、Prisma 与认证 |
| `frontend/` | Vue 工作区、设置和管理界面 |
| `shared/` | 类型、Zod schema 与跨阶段合同 |
| `renderer/` | React / Remotion 视频组合 |
| `prompts/` | 正式中文 prompt、版本与变更记录 |
| `harness/` | 执行治理、离线回归、显式 live/browser 检查 |
| `docs/` | 产品、架构、数据、计划和历史证据 |
| `storage/` | SQLite、项目媒体、trace 与素材目录 |

协作修改遵守 [AGENTS.md](AGENTS.md)：默认在 `dev` 主工作区工作，限定范围、验证、自审并使用中文提交。
