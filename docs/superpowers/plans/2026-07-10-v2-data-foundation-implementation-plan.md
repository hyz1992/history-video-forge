# V2 数据基础与迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Prisma ORM 7.8.0 + SQLite 建立正式数据层，完成 V1 快照审计和可重复导入，同时保留文件资产与旧快照的失败安全边界。

**Architecture:** 先建立领域模型对照表和临时空库验证，再重写 Prisma schema、创建首个 migration 和 repository adapter。旧 `DbClient` 在迁移阶段仅作为只读源与测试夹具；文件资产不进入数据库，数据库保存稳定 `storageKey` 和相对引用。

**Tech Stack:** Node.js 22、TypeScript 5.8、Prisma ORM 7.8.0、SQLite、`@prisma/adapter-better-sqlite3`、Vitest 3。

---

## 文件职责

- `docs/data/v2-domain-model-mapping.md`：当前 Map/快照字段到新数据模型的唯一对照表。
- `backend/prisma/schema.prisma`：完整 Prisma 7 schema。
- `backend/prisma.config.ts`：schema、migration 和 datasource 配置。
- `backend/src/db/prisma-client.ts`：唯一 Prisma Client 初始化入口。
- `backend/src/db/repositories/`：业务 repository 接口及 Prisma 实现。
- `backend/src/db/migration/`：V1 inspect/import/verify，不包含文件移动。
- `backend/src/db/legacy-snapshot-reader.ts`：只读解析 V1 快照。
- `tests/backend/db/prisma-*.test.ts`：schema、migration、CRUD 和导入测试。

## 执行风险控制与停止条件

### R1：新 schema 漏掉当前真实字段

- 控制：Task 1 的模型对照表必须覆盖 `DbClient` 的每个 Map、每个 Project active/trace/storage 字段和快照顶层集合。
- 自动检查：新增 `tests/backend/db/domain-model-mapping.test.ts`，从 `backend/src/db/client.ts` 提取集合名，断言对照表逐项出现。
- 停止条件：对照表存在未归类集合或字段时，禁止执行 Task 2/3，不能提交新 schema。

### R2：空库可用但 V1 导入丢数据

- 控制：inspect、import、verify 分离；源快照 SHA-256、各集合计数、active 外键、项目目录存在性均写入迁移报告。
- 自动检查：同一快照连续导入两次；第二次必须返回 `already_applied` 且数据库计数不变。
- 停止条件：存在 error 级孤儿关系、active record 悬空、项目计数不一致时，禁止 `activate`。
- 恢复：删除未激活的新 SQLite 文件，继续使用原 JSON 快照；禁止修改或覆盖原快照及 `.bak`。

### R3：文件系统和数据库部分成功

- 控制：本计划不移动真实项目文件。数据库只登记稳定 `storageKey`，文件重定位必须另立任务。
- 停止条件：迁移代码出现 `Move-Item`、`rename` 或删除旧项目目录的行为，立即停止并移出本计划。

### R4：SQLite 锁、并发和备份不可靠

- 控制：单实例运行；连接初始化执行 `PRAGMA foreign_keys = ON`、`journal_mode = WAL`、`busy_timeout = 5000`。数据库写入继续受项目阶段锁保护。
- 备份：使用 SQLite 一致性备份机制或停写窗口复制数据库、`-wal` 和 `-shm`；不在活动写入时只复制主 `.db`。
- 部署边界：本期明确只支持单后端实例；如果部署目标变为多实例并发写，立即停止 SQLite 切换并重新评估 PostgreSQL。
- 停止条件：并发 smoke 出现未处理的 `SQLITE_BUSY`、外键未开启或实际部署要求多实例时，不切换主存储。

### R5：旧测试失败掩盖新回归

- 控制：执行前记录现有失败基线；每个任务运行新增聚焦测试和受影响旧测试；最终再跑全量测试。
- 判定：已知旧失败只能标记为“基线未改善”，新增失败必须修复；不能用“旧测试本来就失败”解释新失败。
- 停止条件：受影响旧测试新增失败，或全量失败数高于基线时，不得宣称数据层验收完成。

## 执行前闸门

在 Task 1 前创建 `docs/records/2026-07-10-v2-test-baseline.md`，记录以下命令的退出码、通过/失败/超时数量和已知失败名称：

```bash
npm run typecheck:backend
npm run build
npx vitest run --configLoader runner --no-file-parallelism
```

若全量测试超时，按目录拆分运行并记录未完成分组。该基线只用于区分新旧失败，不把旧失败改写为通过。基线文档使用中文提交：

```bash
git add docs/records/2026-07-10-v2-test-baseline.md
git commit -m "记录V2实施前测试基线"
```

### Task 1：冻结领域模型对照表

**Files:**
- Create: `docs/data/v2-domain-model-mapping.md`
- Create: `tests/backend/db/domain-model-mapping.test.ts`
- Read: `backend/src/db/client.ts`
- Read: `backend/src/db/persistence.ts`
- Read: `backend/prisma/schema.prisma`

- [ ] **Step 1: 枚举当前持久化集合**

在文档中建立表格，至少包含以下行：

```markdown
| 当前集合 | V2 归类 | V2 模型/位置 | 迁移策略 |
|---|---|---|---|
| projects | 主表 | Project | 全量导入，旧项目归首个管理员 |
| recommendationRounds | 主表 | RecommendationRound + RecommendationExposure | 按项目和创建时间导入 |
| mediaLibraryItems | 文件 catalog | storage/media-library/catalog.json | 不复制为主表 |
| voiceProfiles | 文件 catalog + 后续引用 | storage/voice-profiles | 本期不建主表 |
```

- [ ] **Step 2: 补齐字段级映射**

为 Project、EventRegistryEntry 和全部流水线 record 列出旧字段、新字段、是否必填、默认值和丢弃原因；不得遗漏 `activePublishPackageRecordId`、各阶段 trace 和 storage 字段。

- [ ] **Step 3: 记录约束决策**

明确：候选指纹使用项目作用域复合索引；流水线记录使用 `onDelete: Restrict`；Project 使用软归档；大文件不入库。

- [ ] **Step 4: 自动检查映射覆盖率**

测试读取 `backend/src/db/client.ts`，提取 `DbClient` 中的 Map 属性名，并断言每个名称出现在对照表第一列。

Run:

```bash
rg -n "Map<string" backend/src/db/client.ts
npx vitest run --configLoader runner tests/backend/db/domain-model-mapping.test.ts
```

Expected: 每个 Map 都能在对照表中找到一行。

- [ ] **Step 5: 提交**

```bash
git add docs/data/v2-domain-model-mapping.md tests/backend/db/domain-model-mapping.test.ts
git commit -m "冻结V2领域模型映射"
```

### Task 2：安装并验证 Prisma 7 工具链

**Files:**
- Modify: `backend/package.json`
- Modify: `package-lock.json`
- Create: `backend/prisma.config.ts`
- Modify: `backend/prisma/schema.prisma`
- Test: `tests/backend/db/prisma-toolchain.test.ts`

- [ ] **Step 1: 写工具链失败测试**

测试执行 `npm exec --workspace backend -- prisma validate --config prisma.config.ts`，断言退出码为 0，并断言 schema 使用：

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}
```

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-toolchain.test.ts`

Expected: FAIL，原因是 Prisma 依赖或配置尚不存在。

- [ ] **Step 3: 安装锁定版本并配置**

Run:

```bash
npm install --workspace backend @prisma/client@7.8.0 @prisma/adapter-better-sqlite3@7.8.0
npm install --workspace backend --save-dev prisma@7.8.0 @types/better-sqlite3
```

创建 `backend/prisma.config.ts`：

```ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
```

- [ ] **Step 4: 生成 client 并通过测试**

Run:

```bash
$env:DATABASE_URL='file:./storage/test-prisma-toolchain.db'
npm exec --workspace backend -- prisma generate --config prisma.config.ts
npx vitest run --configLoader runner tests/backend/db/prisma-toolchain.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/package.json package-lock.json backend/prisma.config.ts backend/prisma/schema.prisma tests/backend/db/prisma-toolchain.test.ts
git commit -m "建立Prisma七工具链"
```

### Task 3：重建完整 schema 与首个 migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/0001_v2_baseline/migration.sql`
- Test: `tests/backend/db/prisma-schema.test.ts`
- Modify: `tests/backend/repositories/repository-contracts.test.ts`

- [ ] **Step 1: 写 schema 结构测试**

测试读取 Prisma DMMF 或使用生成 client 类型，断言存在：

```ts
const requiredModels = [
  "User", "Session", "Project", "EventRegistryEntry", "TopicPackage",
  "ScriptRecord", "StoryboardRecord", "AssetPlanRecord", "AssetManifestRecord",
  "ComposeRecord", "RenderJobRecord", "PublishPackageRecord",
  "AssetProviderJobRecord", "RecommendationRound", "RecommendationExposure",
  "AuditLog", "DataMigrationRun",
];
```

同时断言 `Project.ownerId`、`Project.storageKey`、`Project.activePublishPackageRecordId` 存在。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-schema.test.ts`

Expected: FAIL，列出缺失模型/字段。

- [ ] **Step 3: 按映射表重写 schema**

关键关系使用显式 relation 和索引：

```prisma
model RecommendationExposure {
  id                   String   @id @default(uuid())
  roundId              String
  eventRegistryEntryId String?
  eventIdentity        String
  fingerprint          String
  title                String?
  createdAt            DateTime @default(now())
  round                 RecommendationRound @relation(fields: [roundId], references: [id], onDelete: Cascade)

  @@unique([roundId, fingerprint])
  @@index([eventIdentity, createdAt])
}
```

所有 active record 使用可空外键；删除策略显式声明，不依赖 Prisma 默认值。

- [ ] **Step 4: 创建并验证空库 migration**

Run:

```bash
$env:DATABASE_URL='file:./storage/test-v2-baseline.db'
npm exec --workspace backend -- prisma migrate dev --name v2_baseline --config prisma.config.ts
npx vitest run --configLoader runner tests/backend/db/prisma-schema.test.ts
```

Expected: migration 和测试通过；旧的字符串包含测试被真实 schema 测试替代。

- [ ] **Step 5: 提交**

```bash
git add backend/prisma tests/backend/db/prisma-schema.test.ts tests/backend/repositories/repository-contracts.test.ts
git commit -m "重建V2数据库基线模型"
```

### Task 4：建立 Prisma Client 与事务 CRUD smoke

**Files:**
- Create: `backend/src/db/prisma-client.ts`
- Create: `backend/src/db/prisma-client.types.ts`
- Test: `tests/backend/db/prisma-client.test.ts`

- [ ] **Step 1: 写事务失败测试**

测试创建 User、Project、TopicPackage，并在事务抛错时断言三者都未写入。
增加并发测试：同一项目的两个状态更新在 `busy_timeout` 内完成或返回受控冲突，不允许泄漏原始 `SQLITE_BUSY`。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-client.test.ts`

Expected: FAIL，缺少 `createPrismaClient`。

- [ ] **Step 3: 实现唯一初始化入口**

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}
```

生产代码不得直接 `new PrismaClient()`。
初始化后执行并断言：`foreign_keys=1`、`journal_mode=wal`、`busy_timeout=5000`。

- [ ] **Step 4: 通过事务测试和类型检查**

Run:

```bash
npx vitest run --configLoader runner tests/backend/db/prisma-client.test.ts
npm run typecheck:backend
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/db/prisma-client.ts backend/src/db/prisma-client.types.ts tests/backend/db/prisma-client.test.ts
git commit -m "接通Prisma事务客户端"
```

### Task 5：建立 repository 边界

**Files:**
- Create: `backend/src/db/repositories/project-store.ts`
- Create: `backend/src/db/repositories/prisma-project-store.ts`
- Create: `backend/src/db/repositories/recommendation-store.ts`
- Create: `backend/src/db/repositories/prisma-recommendation-store.ts`
- Test: `tests/backend/db/prisma-repositories.test.ts`

- [ ] **Step 1: 写 repository contract**

```ts
export interface ProjectStore {
  create(input: CreateProjectRecordInput): Promise<ProjectRecord>;
  findAccessibleById(projectId: string, ownerId?: string): Promise<ProjectRecord | null>;
  listByOwner(ownerId: string): Promise<ProjectRecord[]>;
  updateStatus(projectId: string, status: string): Promise<ProjectRecord>;
}
```

RecommendationStore 必须支持记录一轮 exposure 和查询项目近期 eventIdentity。

- [ ] **Step 2: 确认 contract 测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-repositories.test.ts`

Expected: FAIL，Prisma 实现缺失。

- [ ] **Step 3: 实现最小 Prisma repository**

所有 snake_case/camelCase 转换集中在 repository mapper；业务层不导入生成的 Prisma model。

- [ ] **Step 4: 通过 CRUD 和推荐记忆重启测试**

测试关闭 client、重新创建 client，再查询同一项目和 RecommendationExposure。

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-repositories.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/db/repositories tests/backend/db/prisma-repositories.test.ts
git commit -m "建立数据库仓储边界"
```

### Task 6：实现 V1 快照 inspect

**Files:**
- Create: `backend/src/db/legacy-snapshot-reader.ts`
- Create: `backend/src/db/migration/inspect-legacy-snapshot.ts`
- Create: `backend/src/db/migration/migration-report.ts`
- Test: `tests/backend/db/legacy-migration-inspect.test.ts`

- [ ] **Step 1: 写损坏与孤儿样本测试**

测试输入包含有效项目、缺失 storage 目录、孤儿 record、重复 ID；断言报告包含计数和错误代码，但不修改输入文件。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/legacy-migration-inspect.test.ts`

Expected: FAIL，inspect 函数不存在。

- [ ] **Step 3: 实现只读 inspect**

返回稳定结构：

```ts
interface LegacyMigrationInspection {
  sourcePath: string;
  counts: Record<string, number>;
  issues: Array<{ code: string; severity: "warning" | "error"; recordId?: string }>;
  canImport: boolean;
}
```

- [ ] **Step 4: 验证只读性**

测试运行前后计算快照 SHA-256，必须相同。

Run: `npx vitest run --configLoader runner tests/backend/db/legacy-migration-inspect.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/db/legacy-snapshot-reader.ts backend/src/db/migration tests/backend/db/legacy-migration-inspect.test.ts
git commit -m "增加V1快照迁移审计"
```

### Task 7：实现幂等 import 与 verify

**Files:**
- Create: `backend/src/db/migration/import-legacy-snapshot.ts`
- Create: `backend/src/db/migration/verify-legacy-import.ts`
- Create: `backend/src/cli/migrate-legacy-data.ts`
- Test: `tests/backend/db/legacy-migration-import.test.ts`

- [ ] **Step 1: 写双次导入失败测试**

第一次导入完整快照；第二次导入同一 `sourceChecksum`，断言所有表计数不变，并返回 `already_applied`。
增加失败样本：active record 指向不存在记录时，import 必须回滚整个事务且不创建 `completed` migration marker。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/legacy-migration-import.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现事务导入**

使用 `DataMigrationRun.sourceChecksum @unique` 作为幂等键；旧项目归属传入的 `defaultOwnerId`。文件只登记 `storageKey`，不移动。

- [ ] **Step 4: 验证计数与 active 关系**

Run:

```bash
npx vitest run --configLoader runner tests/backend/db/legacy-migration-import.test.ts
npm run typecheck:backend
```

Expected: PASS；verify 报告没有 dangling active record。

- [ ] **Step 5: 提交**

```bash
git add backend/src/db/migration backend/src/cli/migrate-legacy-data.ts tests/backend/db/legacy-migration-import.test.ts
git commit -m "实现V1数据幂等迁移"
```

### Task 8：接入 readiness 并完成数据层验收

**Files:**
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`
- Modify: `scripts/build-backend.mjs`
- Test: `tests/backend/server-http.test.ts`
- Create: `tests/backend/db/prisma-readiness.test.ts`
- Modify: `docs/records/2026-07-10-v1-to-v2-transition-record.md`

- [ ] **Step 1: 写 readiness 失败测试**

覆盖数据库不可写、migration 未应用、Prisma Client 可查询三种状态；前两种 `/readyz` 返回 503。
增加 `foreign_keys` 未开启、WAL/busy timeout 配置失败和迁移 verify 未通过场景，均返回 503。

- [ ] **Step 2: 确认测试失败**

Run: `npx vitest run --configLoader runner tests/backend/db/prisma-readiness.test.ts tests/backend/server-http.test.ts`

Expected: FAIL，readiness 尚未检查数据库。

- [ ] **Step 3: 接入数据库健康检查与构建 generate**

构建顺序固定为 `prisma generate → tsc/esbuild`；应用关闭时调用 `$disconnect()`。

- [ ] **Step 4: 完成验收命令**

Run:

```bash
npm exec --workspace backend -- prisma validate --config prisma.config.ts
npm exec --workspace backend -- prisma generate --config prisma.config.ts
npx vitest run --configLoader runner tests/backend/db/prisma-toolchain.test.ts tests/backend/db/prisma-schema.test.ts tests/backend/db/prisma-client.test.ts tests/backend/db/prisma-repositories.test.ts tests/backend/db/legacy-migration-inspect.test.ts tests/backend/db/legacy-migration-import.test.ts tests/backend/db/prisma-readiness.test.ts --no-file-parallelism
npm run typecheck:backend
npm run build:backend
npx vitest run --configLoader runner --no-file-parallelism
```

Expected: 聚焦测试全部通过；全量测试失败数不得高于实施前记录的基线，所有新增失败必须为 0。若旧失败仍存在，只能在验收记录中逐项标为未闭环。

- [ ] **Step 5: 记录证据并提交**

```bash
git add backend scripts tests docs/records/2026-07-10-v1-to-v2-transition-record.md
git commit -m "完成V2数据基础验收"
```

## 实施完成条件

- 空库 migration、生成 client、事务 CRUD 均通过。
- V1 inspect 不修改源数据。
- 同一快照导入两次不重复。
- 数据库异常能阻断 `/readyz`。
- 未移动任何现有真实项目文件。
- 尚未启用登录和项目访问拦截；这些属于下一份计划。
- 全量测试相对实施前基线没有新增失败；仍存在的旧失败逐项保留状态。
