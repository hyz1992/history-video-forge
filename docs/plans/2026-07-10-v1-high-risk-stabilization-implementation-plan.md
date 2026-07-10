# V1 高风险稳定化实施计划

> **面向 agent 执行者：**实施本计划时必须使用 `superpowers:executing-plans`，逐任务执行并在每个提交后复核。只有用户明确授权并行代理时，才可改用 `superpowers:subagent-driven-development`。所有步骤使用复选框跟踪。

**目标：**在进入 V2 功能开发前，先阻止现有 V1 出现数据覆盖、公网误暴露、假构建成功、生成任务永久卡死、付费请求重复和测试污染真实存储等高风险故障。

**架构：**本轮只做 V1 止血和可恢复性补强，不引入 Prisma、正式用户系统、Redis、消息队列或内容策略平台。修复采用“兼容读取、原子写入、显式失败、最小恢复、低耦合提交”的方式，为后续数据库迁移保留清晰边界，避免把 JSON 快照继续扩建成长期数据库。

**技术栈：**Node.js 20、TypeScript、Vitest、Vue 3、现有内存 `DbClient`、JSON snapshot、PowerShell/NSSM、OpenAI-compatible provider。

---

## 0. 范围、优先级与阶段闸门

### 本轮包含

| 优先级 | 工作项 | 完成闸门 |
|---|---|---|
| P0-1 | 现有数据备份与快照兼容 | 旧快照可完整恢复 7 个候选历史项目，失败加载不污染内存 |
| P0-2 | 快照原子写入与显式失败 | 中断写入后主文件或备份至少一个可恢复，错误不再静默 |
| P0-3 | 构建真实性 | TypeScript 编译失败时 `npm run build` 必须非零退出，旧 dist 不得冒充新构建 |
| P0-4 | 临时远程访问边界 | 无显式批准时拒绝绑定非回环地址，部署文档不再默认裸露公网 |
| P0-5 | 测试存储隔离 | 默认 Vitest 不再写入真实 `storage/projects/` |
| P0-6 | 媒体库与全局音色库接线 | 生产启动可加载 16 条媒体记录，全局音色不再绑定首个项目 |
| P0-7 | 中断任务恢复 | 重启后不再无限停留在 `*_generating`，provider job 可识别为待人工重试 |
| P1-1 | 并发锁与真实超时取消 | 同项目同阶段只允许一个付费任务；超时请求收到 `AbortSignal` |
| P1-2 | 推荐记忆与 fingerprint 一致性 | 重启后 recent memory 保留；同一候选不再因两套 fingerprint 重复入库 |
| P1-3 | 删除、备份、ready 检查 | 删除失败不报告成功；备份在停服状态执行；`/readyz` 能暴露依赖缺失 |

### 本轮明确不包含

- 不接入 Prisma 或真实数据库。
- 不实现正式登录、管理员和成员权限。
- 不实现事件库、自定义选题、筛选扩展、神话故事或内容策略切换。
- 不更换主模型，不调整正式 prompt 语义。
- 不把 semantic reviewer 接入自动门禁。
- 不自动删除现有 2.89 GB 存储内容；本轮只提供只读审计和明确删除确认。

### 全局执行规则

1. Task 0 未完成，不得执行任何会写 `storage/` 的测试或服务命令。
2. Task 1 未通过旧快照兼容测试，不得执行后续状态变更接口。
3. 每个 Task 独立提交，提交信息必须使用中文。
4. 涉及 `storage/topic-candidate-library/` 的测试必须串行运行。
5. 默认测试命令使用 `npx vitest run --configLoader runner ... --no-file-parallelism`。
6. 真实 LLM、TTS、图片和视频 provider 检查不作为自动门；需要显式批准并记录成本。

---

### Task 0：冻结运行状态并建立可验证备份

**文件：**
- 不修改仓库文件。
- 产物必须保存到仓库外，例如 `D:\story-video-forge2-backups\<timestamp>\`。

- [ ] **Step 1：确认本机或服务器进程已停止**

运行：

```powershell
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path
Get-Service history-video-forge -ErrorAction SilentlyContinue | Select-Object Status, Name
```

预期：没有指向本项目的 Node 进程；若 NSSM 服务存在，状态为 `Stopped`。

- [ ] **Step 2：复制完整 storage 到仓库外**

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = "D:\story-video-forge2-backups\$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath 'D:\myproject\story-video-forge2\storage' -Destination $backupRoot -Recurse -Force
```

预期：`$backupRoot\storage\db-snapshot.json` 存在，项目媒体文件数量大于 0。

- [ ] **Step 3：记录备份证据**

```powershell
$snapshot = Join-Path $backupRoot 'storage\db-snapshot.json'
$parsed = Get-Content -Raw -Encoding utf8 $snapshot | ConvertFrom-Json
[pscustomobject]@{
  SavedAt = $parsed.savedAt
  Projects = @($parsed.projects).Count
  TopicCandidateProjects = @($parsed.topicCandidateStore.PSObject.Properties).Count
  Files = @(Get-ChildItem (Join-Path $backupRoot 'storage') -Recurse -File).Count
  SnapshotSha256 = (Get-FileHash $snapshot -Algorithm SHA256).Hash
} | Format-List
```

预期：当前基线应能观察到约 9 个项目、7 个候选历史项目；若实际数量不同，以备份命令输出为准并停止执行，先解释差异。

- [ ] **Step 4：验证备份可读，不提交备份文件**

运行：

```powershell
git status --short
```

预期：工作区没有因备份产生新文件。Task 0 是操作闸门，不创建提交。

---

### Task 1：修复旧快照兼容、部分载入与原子写入

**文件：**
- Modify: `backend/src/db/persistence.ts`
- Modify: `backend/src/app.ts`
- Create: `tests/backend/db/persistence.test.ts`
- Modify: `tests/backend/server-http.test.ts`

- [ ] **Step 1：写旧快照兼容失败测试**

在 `tests/backend/db/persistence.test.ts` 创建临时目录，并构造缺少 `publishPackageRecords`、`assetProviderJobRecords` 的真实旧版形状：

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { loadDbSnapshot } from "../../../backend/src/db/persistence.js";

describe("db snapshot compatibility", () => {
  it("loads legacy v1 without publishPackageRecords and preserves topic rounds", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-snapshot-v1-"));
    const snapshotPath = join(root, "db-snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({
      version: "db_snapshot_v1",
      savedAt: "2026-07-08T03:50:14.194Z",
      projects: [["project_1", { id: "project_1", name: "旧项目", status: "topic_candidates_ready" }]],
      events: [],
      topicPackages: [],
      candidateCache: [],
      topicRunCounts: [["project_1", 1]],
      scriptRecords: [],
      storyboardRecords: [],
      assetPlanRecords: [],
      assetManifestRecords: [],
      composeRecords: [],
      renderJobRecords: [],
      topicCandidateStore: {
        project_1: {
          candidatesById: { candidate_1: { candidateId: "candidate_1", projectId: "project_1" } },
          rounds: [{ roundId: "round_1", roundIndex: 1, createdAt: "2026-07-08T00:00:00.000Z", candidates: [] }],
        },
      },
    }), "utf8");

    const db = createDbClient();
    const topicStore = new Map();
    const result = loadDbSnapshot(db, topicStore, { snapshotPath });

    expect(result).toMatchObject({ ok: true, migratedFrom: "db_snapshot_v1" });
    expect(db.projects.size).toBe(1);
    expect(db.publishPackageRecords.size).toBe(0);
    expect(db.assetProviderJobRecords.size).toBe(0);
    expect(topicStore.get("project_1")?.rounds).toHaveLength(1);
  });
});
```

- [ ] **Step 2：写失败加载不污染 DbClient 的测试**

追加：

```ts
it("does not partially mutate db when snapshot is malformed", () => {
  const root = mkdtempSync(join(tmpdir(), "svf2-snapshot-bad-"));
  const snapshotPath = join(root, "db-snapshot.json");
  writeFileSync(snapshotPath, '{"version":"db_snapshot_v1","projects":[', "utf8");

  const db = createDbClient();
  db.projects.set("existing", { id: "existing" } as never);
  const topicStore = new Map();
  const result = loadDbSnapshot(db, topicStore, { snapshotPath });

  expect(result.ok).toBe(false);
  expect(db.projects.has("existing")).toBe(true);
  expect(db.projects.size).toBe(1);
  expect(topicStore.size).toBe(0);
});
```

- [ ] **Step 3：运行测试确认失败**

```powershell
npx vitest run --configLoader runner tests/backend/db/persistence.test.ts --no-file-parallelism
```

预期：FAIL，原因是当前 API 不支持 `snapshotPath`，且旧快照在缺少新字段时返回 `false`。

- [ ] **Step 4：引入 v2 快照和兼容归一化**

在 `persistence.ts` 增加：

```ts
export interface SnapshotPersistenceOptions {
  snapshotPath?: string;
  projectsRoot?: string;
}

export interface SnapshotLoadResult {
  ok: boolean;
  source: "primary" | "backup" | "none";
  migratedFrom: "db_snapshot_v1" | null;
  error: string | null;
}

interface DbSnapshotV2 extends Omit<DbSnapshot, "version"> {
  version: "db_snapshot_v2";
  assetProviderJobRecords: Array<Record<string, unknown>>;
}

function normalizeSnapshotDocument(value: unknown): DbSnapshotV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("db_snapshot_invalid_root");
  }
  const source = value as Record<string, unknown>;
  if (source.version !== "db_snapshot_v1" && source.version !== "db_snapshot_v2") {
    throw new Error("db_snapshot_unsupported_version");
  }
  const array = (key: string) => Array.isArray(source[key]) ? source[key] as Array<Record<string, unknown>> : [];
  return {
    version: "db_snapshot_v2",
    savedAt: typeof source.savedAt === "string" ? source.savedAt : new Date(0).toISOString(),
    projects: array("projects"),
    events: array("events"),
    topicPackages: array("topicPackages"),
    candidateCache: array("candidateCache"),
    topicRunCounts: Array.isArray(source.topicRunCounts) ? source.topicRunCounts as Array<[string, number]> : [],
    scriptRecords: array("scriptRecords"),
    storyboardRecords: array("storyboardRecords"),
    assetPlanRecords: array("assetPlanRecords"),
    assetManifestRecords: array("assetManifestRecords"),
    composeRecords: array("composeRecords"),
    renderJobRecords: array("renderJobRecords"),
    publishPackageRecords: array("publishPackageRecords"),
    assetProviderJobRecords: array("assetProviderJobRecords"),
    topicCandidateStore:
      source.topicCandidateStore && typeof source.topicCandidateStore === "object" && !Array.isArray(source.topicCandidateStore)
        ? source.topicCandidateStore as DbSnapshotV2["topicCandidateStore"]
        : {},
  };
}
```

要求：先在临时 `DbClient` 和临时 topic store 中完成全部反序列化，成功后再一次性替换目标 Map；不得边解析边修改正式 Map。

- [ ] **Step 5：实现原子保存和 `.bak` 回退**

使用同目录临时文件、刷新文件句柄、替换主文件：

```ts
import { closeSync, copyFileSync, fsyncSync, openSync, renameSync } from "node:fs";

function writeSnapshotAtomically(snapshotPath: string, body: string): void {
  const tempPath = `${snapshotPath}.tmp`;
  const backupPath = `${snapshotPath}.bak`;
  mkdirSync(dirname(snapshotPath), { recursive: true });
  if (existsSync(snapshotPath)) copyFileSync(snapshotPath, backupPath);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, snapshotPath);
}
```

`saveDbSnapshot()` 写入 `db_snapshot_v2`，包含 `publishPackageRecords` 和 `assetProviderJobRecords`。`loadDbSnapshot()` 主文件失败时尝试 `.bak`，两者都失败时返回带错误原因的 `SnapshotLoadResult`，不得吞异常文本。

- [ ] **Step 6：让应用记录持久化健康状态**

在 `AppInstance` 增加：

```ts
persistenceHealth: {
  loaded: boolean;
  source: "primary" | "backup" | "none";
  error: string | null;
};
```

`buildApp()` 保存 `loadDbSnapshot()` 结果；写入失败时记录错误并让本次状态变更请求返回 `503`、`error: "persistence_failed"`，同时把详细错误只写服务端日志。

- [ ] **Step 7：运行聚焦测试**

```powershell
npx vitest run --configLoader runner tests/backend/db/persistence.test.ts tests/backend/server-http.test.ts tests/backend/projects/project-snapshot.test.ts --no-file-parallelism
```

预期：全部 PASS；旧快照缺字段、坏 JSON、主文件坏但备份可读、保存失败四条路径均有断言。

- [ ] **Step 8：在备份副本上验证真实旧快照**

将 Task 0 的 `db-snapshot.json` 复制到临时目录，使用测试辅助函数加载；不得直接对生产 snapshot 调用保存。

预期：9 个项目、7 个候选历史项目完整恢复；结果只写临时目录。

- [ ] **Step 9：提交**

```powershell
git add backend/src/db/persistence.ts backend/src/app.ts tests/backend/db/persistence.test.ts tests/backend/server-http.test.ts
git commit -m "修复旧快照兼容与原子持久化"
```

---

### Task 2：让构建失败真实传播并清除旧产物

**文件：**
- Modify: `scripts/build-backend.mjs`
- Create: `tests/scripts/build-backend.test.ts`
- Modify: `package.json`

- [ ] **Step 1：写失败传播测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runBackendBuild } from "../../scripts/build-backend.mjs";

describe("backend build", () => {
  it("throws when TypeScript compilation fails and removes stale dist first", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-build-"));
    const distDir = join(root, "backend", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "stale.js"), "stale", "utf8");
    const exec = vi.fn(() => { throw new Error("tsc failed"); });

    expect(() => runBackendBuild({ distDir, exec })).toThrow("tsc failed");
    expect(exec).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```powershell
npx vitest run --configLoader runner tests/scripts/build-backend.test.ts --no-file-parallelism
```

预期：FAIL，`runBackendBuild` 尚未导出。

- [ ] **Step 3：重构构建脚本**

`runBackendBuild()` 必须先删除 `backend/dist`，再执行 `npx tsc`；不得捕获后改成成功退出。直接执行脚本时只调用该函数一次：

```js
export function runBackendBuild({
  distDir = "backend/dist",
  exec = (command) => execSync(command, { stdio: "inherit" }),
} = {}) {
  rmSync(distDir, { recursive: true, force: true });
  exec("npx tsc -p backend/tsconfig.json");
  fixExtensionlessImports(distDir);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runBackendBuild();
}
```

补齐 `rmSync`、`resolve`、`fileURLToPath` import。`package.json` 增加只读检查：

```json
"typecheck:backend": "tsc -p backend/tsconfig.json --noEmit"
```

- [ ] **Step 4：运行测试与真实构建**

```powershell
npx vitest run --configLoader runner tests/scripts/build-backend.test.ts --no-file-parallelism
npm run typecheck:backend
npm run build
```

预期：全部成功；人为制造 TypeScript 错误的测试夹具必须得到非零退出。

- [ ] **Step 5：提交**

```powershell
git add scripts/build-backend.mjs tests/scripts/build-backend.test.ts package.json
git commit -m "让后端构建失败真实传播"
```

---

### Task 3：增加无鉴权远程绑定安全闸门

**文件：**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/server.ts`
- Modify: `.env.example`
- Modify: `DEPLOY_WINDOWS_SERVER.md`
- Modify: `service-manager.ps1`
- Test: `tests/backend/server-http.test.ts`
- Test: `tests/backend/runtime/env-loading.test.ts`

- [ ] **Step 1：写远程绑定拒绝测试**

```ts
import { describe, expect, it } from "vitest";
import { resolveServerHost } from "../../../backend/src/server.js";

describe("unauthenticated remote bind guard", () => {
  it("allows loopback without an override", () => {
    expect(resolveServerHost({ host: "127.0.0.1", allowUnauthenticatedRemote: false })).toBe("127.0.0.1");
  });

  it("rejects 0.0.0.0 unless explicitly approved", () => {
    expect(() => resolveServerHost({ host: "0.0.0.0", allowUnauthenticatedRemote: false }))
      .toThrow("unsafe_unauthenticated_remote_bind");
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```powershell
npx vitest run --configLoader runner tests/backend/server-http.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
```

预期：FAIL，缺少新配置和 resolver。

- [ ] **Step 3：实现显式 opt-in**

`AppEnv` 增加 `allowUnauthenticatedRemote: boolean`，仅接受 `ALLOW_UNAUTHENTICATED_REMOTE=true`。`resolveServerHost()` 对 `127.0.0.1`、`localhost`、`::1` 放行，其他地址要求显式 opt-in。

`.env.example` 使用：

```env
SERVER_HOST=127.0.0.1
ALLOW_UNAUTHENTICATED_REMOTE=false
```

部署文档删除默认 `0.0.0.0/0` 暴露方案，改为：回环地址 + nginx/VPN/IP allowlist。只有临时演示环境才允许显式 opt-in，并用醒目标记说明所有 API 尚无正式鉴权。

- [ ] **Step 4：修正 service-manager 健康检查地址**

本机健康检查固定访问 `http://127.0.0.1:<port>/healthz`，不要求服务绑定公网地址。

- [ ] **Step 5：运行验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/server-http.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
git add backend/src/config/env.ts backend/src/server.ts .env.example DEPLOY_WINDOWS_SERVER.md service-manager.ps1 tests/backend/server-http.test.ts tests/backend/runtime/env-loading.test.ts
git commit -m "增加无鉴权远程绑定安全闸门"
```

---

### Task 4：阻止 Vitest 写入真实项目存储

**文件：**
- Modify: `backend/src/runtime/trace/project-storage.ts`
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Create: `tests/backend/runtime/test-storage-isolation.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1：写真实目录不变测试**

测试先记录 `storage/projects` 下文件名集合，创建项目并写 trace，随后断言集合不变：

```ts
it("does not write project traces under workspace storage during Vitest", async () => {
  const before = listWorkspaceProjectFiles();
  const db = createDbClient();
  const project = await createProject(db, { name: "storage isolation" });
  const writer = createProjectRunInteractionLogWriter({ project, phase: "topic", runId: "run_1" });
  await writer.write(makeInteractionEntry());
  expect(listWorkspaceProjectFiles()).toEqual(before);
});
```

- [ ] **Step 2：运行测试确认失败**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/test-storage-isolation.test.ts --no-file-parallelism
```

预期：FAIL，当前 trace writer 会创建真实目录。

- [ ] **Step 3：为测试配置独立存储根**

在 `vitest.config.ts` 顶部显式导入 `tmpdir` 与 `resolve`，并在 test 配置中设置带进程号的独立目录，避免并行 Vitest 进程互相覆盖：

```ts
env: {
  VITEST: "1",
  NODE_ENV: "test",
  STORAGE_ROOT_DIR: resolve(tmpdir(), "story-video-forge2-vitest-storage", String(process.pid)),
},
```

测试启动时只清理本进程对应的 PID 子目录，测试结束时再删除该目录；不得清理 `tmpdir()` 下其他进程或用户目录。

`project-storage.ts` 统一通过 `resolveStorageBaseDir()` 解析存储根；生产默认仍为 `process.cwd()`，测试不得回落到 workspace。`assets-run.service.ts` 不得在测试中用项目相对路径配置全局音色库。

- [ ] **Step 4：运行受影响测试并确认仓库目录不增长**

```powershell
$before = @(Get-ChildItem storage\projects -Recurse -File).Count
npx vitest run --configLoader runner tests/backend/runtime/test-storage-isolation.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/assets/assets-run-service.test.ts --no-file-parallelism
$after = @(Get-ChildItem storage\projects -Recurse -File).Count
if ($after -ne $before) { throw "workspace storage polluted: $before -> $after" }
```

预期：测试 PASS，`$after -eq $before`。

- [ ] **Step 5：提交**

```powershell
git add backend/src/runtime/trace/project-storage.ts backend/src/modules/assets/assets-run.service.ts tests/backend/runtime/test-storage-isolation.test.ts vitest.config.ts
git commit -m "隔离测试运行时存储目录"
```

---

### Task 5：接通生产媒体库并修正全局音色根目录

**文件：**
- Create: `backend/src/modules/assets/media-library-catalog.loader.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `backend/src/modules/assets/voice/voice-profile.repository.ts`
- Create: `harness/scripts/runtime/audit-voice-profile-migration.ts`
- Test: `tests/backend/assets/media-library-startup.test.ts`
- Test: `tests/backend/assets/voice-profile-persistence-root.test.ts`

- [ ] **Step 1：写生产启动媒体库测试**

```ts
it("loads approved media catalog items during app startup", async () => {
  const root = mkdtempSync(join(tmpdir(), "svf2-media-startup-"));
  writeCatalog(root, [makeApprovedBgm(), makeApprovedSfx()]);
  const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });
  expect(app.db.mediaLibraryItems.size).toBe(2);
});
```

- [ ] **Step 2：写音色根不依赖项目顺序测试**

```ts
it("keeps one workspace voice library regardless of first project", async () => {
  const root = mkdtempSync(join(tmpdir(), "svf2-voice-root-"));
  const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });
  const first = await createProject(app.db, { name: "first" });
  const second = await createProject(app.db, { name: "second" });
  configureWorkspaceVoiceProfilePersistence(app.db, root);
  expect(app.db.voiceProfilePersistence.rootDir).toBe(root);
  expect(app.db.voiceProfilePersistence.rootDir).not.toBe(first.storageRootDir);
  expect(app.db.voiceProfilePersistence.rootDir).not.toBe(second.storageRootDir);
});
```

- [ ] **Step 3：扩展启动参数并实现同步的严格 catalog loader**

`BuildAppOptions` 新增 `storageBaseDir?: string` 和 `skipSnapshotLoad?: boolean`，所有启动期持久化路径都从该根目录解析。loader 同步读取 `<storageBaseDir>/storage/media-library/catalog.json`，验证 `schema_version`、`items` 数组和每条 `MediaLibraryItem`；文件不存在允许空库，文件存在但损坏必须记录稳定错误码并使 readiness 失败，不得静默降级。

- [ ] **Step 4：在应用启动时初始化两个全局库**

`buildApp()` 完成 snapshot 加载后：

```ts
loadMediaLibraryCatalog(app.db, { storageBaseDir });
configureWorkspaceVoiceProfilePersistence(app.db, storageBaseDir);
```

删除 `runAssetsGeneration()` 中“首个项目决定 rootDir”的逻辑。全局音色继续在首次使用时惰性 seed，但持久化根必须已在 `buildApp()` 中固定为工作区根，不能再由项目顺序改写。

- [ ] **Step 5：创建只读音色迁移审计脚本**

脚本只扫描带有效 `project.json` 的真实项目目录，输出每个 `voice_profile_id` 的来源、`updated_at` 和 provider ID 冲突；默认不写文件。只有显式 `--apply --source <path>` 才把用户选定来源复制到工作区全局音色库。不得扫描没有 `project.json` 的测试垃圾目录作为迁移来源。

- [ ] **Step 6：运行验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/assets/media-library-startup.test.ts tests/backend/assets/voice-profile-persistence-root.test.ts tests/backend/assets/media-library-repository.test.ts tests/backend/assets/voice-profile-repository.test.ts --no-file-parallelism
npx tsx harness/scripts/runtime/audit-voice-profile-migration.ts
git add backend/src/modules/assets/media-library-catalog.loader.ts backend/src/app.ts backend/src/modules/assets/assets-run.service.ts backend/src/modules/assets/voice/voice-profile.repository.ts harness/scripts/runtime/audit-voice-profile-migration.ts tests/backend/assets/media-library-startup.test.ts tests/backend/assets/voice-profile-persistence-root.test.ts
git commit -m "接通媒体库并修正全局音色持久化"
```

预期：当前 catalog 加载 16 条；审计脚本只输出报告，不修改音色文件。

---

### Task 6：持久化 provider job 并恢复中断生成状态

**文件：**
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/db/persistence.ts`
- Create: `backend/src/runtime/recovery/interrupted-run-recovery.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/runtime/interrupted-run-recovery.test.ts`
- Test: `tests/backend/db/persistence.test.ts`

- [ ] **Step 1：写 provider job 重启恢复测试**

```ts
it("round-trips asset provider jobs through snapshot v2", () => {
  const db = createDbClient();
  db.assetProviderJobRecords.set("job_1", makeProviderJob({ id: "job_1", status: "running" }));
  saveAndReload(db);
  expect(reloaded.assetProviderJobRecords.get("job_1")).toMatchObject({ status: "running" });
});
```

- [ ] **Step 2：写 generating 状态中断恢复测试**

```ts
it.each([
  ["topic_generating", "topic_pending"],
  ["script_generating", "script_ready"],
  ["storyboard_generating", "storyboard_ready"],
  ["asset_plan_generating", "asset_plan_ready"],
  ["assets_generating", "assets_blocked"],
  ["render_rendering", "render_failed"],
])("recovers %s to %s", (from, to) => {
  const db = createDbClient();
  const project = makeProject({ id: "p1", status: from });
  db.projects.set(project.id, project);
  const result = recoverInterruptedRuns(db, { recoveredAt: "2026-07-10T00:00:00.000Z" });
  expect(project.status).toBe(to);
  expect(result.recoveredProjectIds).toContain("p1");
});
```

- [ ] **Step 3：运行测试确认失败**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/interrupted-run-recovery.test.ts tests/backend/db/persistence.test.ts --no-file-parallelism
```

- [ ] **Step 4：实现保守恢复，不自动重提付费任务**

恢复器必须：

- 把运行中 placeholder 的 `executionStateJson.generating` 改为 `false`。
- 写入 `interrupted_at` 和 `recovery_action: "manual_retry_required"`。
- 把 `submitted/running` provider job 改成 `failed`，错误码为 `process_interrupted`。
- 不删除已完成 artifact，不自动再次提交任何 provider 请求。
- 根据上表回到可理解的项目状态。

`buildApp()` 只在 snapshot 成功加载后调用恢复器，并立即原子保存恢复结果。

- [ ] **Step 5：运行阶段快照回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/interrupted-run-recovery.test.ts tests/backend/db/persistence.test.ts tests/backend/projects/project-snapshot.test.ts tests/backend/api/assets-api.test.ts tests/backend/api/render-api.test.ts --no-file-parallelism
git add backend/src/db/client.ts backend/src/db/persistence.ts backend/src/runtime/recovery/interrupted-run-recovery.ts backend/src/app.ts tests/backend/runtime/interrupted-run-recovery.test.ts tests/backend/db/persistence.test.ts
git commit -m "持久化外部任务并恢复中断状态"
```

---

### Task 7：增加项目阶段互斥锁并真正取消超时请求

**文件：**
- Create: `backend/src/runtime/concurrency/project-stage-lock.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/runtime/llm/openai-compatible-provider.ts`
- Modify: `backend/src/modules/topic/topic.controller.ts`
- Modify: `backend/src/modules/script/script.routes.ts`
- Modify: `backend/src/modules/storyboard/storyboard.routes.ts`
- Modify: `backend/src/modules/asset-planning/asset-planning.routes.ts`
- Modify: `backend/src/modules/assets/assets.routes.ts`
- Modify: `backend/src/modules/render/render.routes.ts`
- Test: `tests/backend/runtime/project-stage-lock.test.ts`
- Test: `tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1：写阶段锁测试**

```ts
it("rejects a second run for the same project and stage", async () => {
  const locks = createProjectStageLockRegistry();
  const release = locks.acquire("project_1", "assets");
  expect(() => locks.acquire("project_1", "assets")).toThrow("project_stage_run_in_progress");
  expect(() => locks.acquire("project_1", "script")).not.toThrow();
  release();
  expect(() => locks.acquire("project_1", "assets")).not.toThrow();
});
```

- [ ] **Step 2：写 AbortSignal 测试**

```ts
it("aborts the underlying fetch before retrying a timeout", async () => {
  const observedSignals: AbortSignal[] = [];
  const fetchImpl = vi.fn((_url, init) => {
    observedSignals.push(init.signal as AbortSignal);
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  });
  const provider = createOpenAiCompatibleProvider({ timeoutMs: 5, maxAttempts: 2, fetchImpl });
  await expect(invoke(provider)).rejects.toMatchObject({ code: "timeout", attemptCount: 2 });
  expect(observedSignals).toHaveLength(2);
  expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
});
```

- [ ] **Step 3：实现锁注册表并接入付费入口**

锁 key 使用 `${projectId}:${stage}`；handler 进入时 acquire，在 `finally` 中 release。重复请求返回 `409`：

```json
{
  "error": "project_stage_run_in_progress",
  "message": "当前阶段已有生成任务，请等待完成后再试。"
}
```

不得锁住纯读取、快照、预览和下载接口。

- [ ] **Step 4：将 provider 超时改为 AbortController**

`OpenAiCompatibleProviderOptions` 增加仅供依赖注入和测试使用的 `fetchImpl?: typeof fetch`，默认值为 `globalThis.fetch`。默认调用函数接收 `signal` 并传给 fetch：

```ts
async function invokeWithTimeout<T>(
  operationName: string,
  timeoutMs: number,
  invoke: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await invoke(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
```

只有上一尝试确认 abort 后才能进入 retry delay。

- [ ] **Step 5：运行回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/project-stage-lock.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/safe-write-provider.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/assets-api.test.ts --no-file-parallelism
git add backend/src/runtime/concurrency/project-stage-lock.ts backend/src/app.ts backend/src/runtime/llm/openai-compatible-provider.ts backend/src/modules/topic/topic.controller.ts backend/src/modules/script/script.routes.ts backend/src/modules/storyboard/storyboard.routes.ts backend/src/modules/asset-planning/asset-planning.routes.ts backend/src/modules/assets/assets.routes.ts backend/src/modules/render/render.routes.ts tests/backend/runtime/project-stage-lock.test.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "增加阶段互斥与真实请求取消"
```

提交前用 `git diff --cached --name-only` 确认没有把无关 module 一并加入。

---

### Task 8：统一推荐 fingerprint 并持久化近期记忆

**文件：**
- Modify: `backend/src/db/client.ts`
- Modify: `backend/src/db/persistence.ts`
- Modify: `backend/src/modules/cache/candidate-cache.repository.ts`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Test: `tests/backend/topic/topic-recommendation-restart-memory.test.ts`

- [ ] **Step 1：写同一候选只落一份的测试**

```ts
it("uses normalized event identity for every persisted fingerprint", async () => {
  const result = await runRecommendationOnce({ eventIdentity: "淝水之战", angle: "八万晋军击败前秦" });
  const records = [...result.db.candidateCache.values()].filter((item) => item.eventIdentity === "淝水之战");
  expect(new Set(records.map((item) => item.fingerprint))).toEqual(new Set(["淝水之战::八万晋军击败前秦"]));
  expect(records).toHaveLength(1);
});
```

- [ ] **Step 2：写重启后 recent memory 保留测试**

```ts
it("preserves recent recommendation rounds after snapshot reload", async () => {
  const first = await createRecommendationRound("project_1", ["淝水之战"]);
  const reloaded = saveAndReload(first.db);
  const memory = await listRecentProjectRecommendationRounds(reloaded.db, { projectId: "project_1", limit: 3 });
  expect(memory[0]?.candidates[0]?.eventIdentity).toBe("淝水之战");
});
```

- [ ] **Step 3：把 recommendation rounds 移入 DbClient**

新增：

```ts
recommendationRounds: Map<string, ProjectRecommendationRoundRecord[]>;
```

删除 repository 内的模块级 `WeakMap`。快照 v2 增加 `recommendationRounds`，旧快照缺少时可从 `topicCandidateStore.rounds` 做一次兼容投影；无法投影时保持空数组并记录迁移 warning。

- [ ] **Step 4：只保留一种 fingerprint 语义**

所有持久化点必须调用：

```ts
buildEventIdentityFingerprint({
  eventIdentity: normalizeEventIdentityValue(candidate.event_identity),
  angle: candidate.one_line_angle,
});
```

不得再用 discovery seed 的 `canonicalName` 作为事件 fingerprint 左侧。保存前以 `projectId + fingerprint` 查重，命中时更新展示/选中计数，不新建第二条记录。

- [ ] **Step 5：运行串行回归并提交**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-recommendation-restart-memory.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/topic-candidate-library-real-check.test.ts --no-file-parallelism
git add backend/src/db/client.ts backend/src/db/persistence.ts backend/src/modules/cache/candidate-cache.repository.ts backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/topic/topic-recommendation-restart-memory.test.ts
git commit -m "统一选题指纹并持久化近期记忆"
```

---

### Task 9：修正删除、备份和 readiness 行为

**文件：**
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/db/persistence.ts`
- Modify: `backend/src/modules/projects/project.controller.ts`
- Modify: `backend/src/app.ts`
- Modify: `service-manager.ps1`
- Create: `harness/scripts/runtime/audit-storage-orphans.ts`
- Test: `tests/backend/projects/project-delete.test.ts`
- Test: `tests/backend/projects/project-storage-delete.test.ts`
- Test: `tests/backend/server-http.test.ts`

- [ ] **Step 1：写删除失败不报告成功测试**

```ts
it("keeps project metadata when storage deletion fails", async () => {
  const db = createDbClient();
  const project = await createProject(db, { name: "locked project" });
  const result = await deleteProject(db, project.id, {
    deleteStorage: () => ({ ok: false, error: "EPERM" }),
  });
  expect(result).toEqual({ deleted: false, error: "project_storage_delete_failed" });
  expect(db.projects.has(project.id)).toBe(true);
});
```

- [ ] **Step 2：补齐关联内存记录清理测试**

删除成功后断言以下项目态记录不存在：topic package、script、storyboard、asset plan、manifest、compose、render、publish、candidate cache、recommendation rounds、asset provider jobs、topic candidate store。

- [ ] **Step 3：让文件删除先于内存删除且返回结构化结果**

`deleteProjectStorage()` 返回：

```ts
type DeleteStorageResult =
  | { ok: true }
  | { ok: false; error: string };
```

文件删除失败时保留项目和 metadata，API 返回 `409 project_storage_delete_failed`。文件删除成功后再清理内存关联并持久化，避免 `project.json` 导致重启复活。

- [ ] **Step 4：让备份先停服务、验证 ZIP、再恢复原状态**

`Do-Backup` 必须记录服务原状态；运行中则停止服务，压缩后检查 ZIP 大于 0 且包含 `storage/db-snapshot.json`，最后恢复服务。任何一步失败返回非零并保留原备份。

- [ ] **Step 5：新增只读 orphan 审计**

`audit-storage-orphans.ts` 输出：

- 没有有效 `project.json` 的项目目录；
- 不被 active manifest/render/publish 引用的媒体文件；
- 测试命名目录数量和大小；
- 建议删除清单。

默认只输出 JSON/Markdown 报告，不接受删除参数。

- [ ] **Step 6：增加 `/readyz`**

readiness 至少检查：snapshot 成功加载、主/备份状态、prompt registry 可扫描、媒体 catalog 已加载、storage 可写。任何失败返回 `503` 和稳定错误码；`/healthz` 继续只做进程存活检查。

- [ ] **Step 7：运行验证并提交**

```powershell
npx vitest run --configLoader runner tests/backend/projects/project-delete.test.ts tests/backend/projects/project-storage-delete.test.ts tests/backend/server-http.test.ts --no-file-parallelism
npx tsx harness/scripts/runtime/audit-storage-orphans.ts
git add backend/src/modules/projects/project.repository.ts backend/src/db/persistence.ts backend/src/modules/projects/project.controller.ts backend/src/app.ts service-manager.ps1 harness/scripts/runtime/audit-storage-orphans.ts tests/backend/projects/project-delete.test.ts tests/backend/projects/project-storage-delete.test.ts tests/backend/server-http.test.ts
git commit -m "强化项目删除备份与就绪检查"
```

---

### Task 10：最终回归、故障演练与文档收口

**文件：**
- Modify: `docs/README.md`
- Modify: `docs/architecture/recent-memory-design.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/todos/roadmap-todo.md`
- Modify: `docs/plans/README.md`
- Create: `docs/records/2026-07-10-v1-high-risk-stabilization-verification.md`

- [ ] **Step 1：运行静态和聚焦回归**

```powershell
npm run typecheck:backend
npx vitest run --configLoader runner tests/backend/db/persistence.test.ts tests/backend/runtime/interrupted-run-recovery.test.ts tests/backend/runtime/project-stage-lock.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/topic/topic-recommendation-restart-memory.test.ts tests/backend/projects/project-delete.test.ts tests/backend/server-http.test.ts --no-file-parallelism
```

预期：全部 PASS，无真实 provider 调用。

- [ ] **Step 2：运行全量自动化测试**

```powershell
npx vitest run --configLoader runner --no-file-parallelism
```

预期：全部 PASS；运行前后 `storage/projects` 文件数和大小不增长。

- [ ] **Step 3：在 storage 副本上做进程中断演练**

使用独立 `STORAGE_ROOT_DIR`：

1. 从备份复制数据。
2. 启动后确认 `/readyz=200`。
3. 触发 mocked 长任务进入 generating。
4. 强制终止进程。
5. 重启并确认项目进入明确的可重试/失败状态。
6. 对比项目、topic candidate rounds、provider jobs、publish packages 数量。

预期：没有永久 generating；记录数量没有无解释下降；主 snapshot 或 `.bak` 至少一个可读。

- [ ] **Step 4：真实浏览器最小验收**

在不调用真实付费 provider 的模式下验证：项目列表、项目刷新、选题候选历史、生成中的重复点击提示、服务重启后的状态、删除失败提示、render preview、publish export。每项记录 `已通过`、`未通过` 或 `未验证`。

- [ ] **Step 5：同步正式文档**

- `docs/README.md`：记录稳定化完成状态和仍未实现的真实数据库/正式鉴权。
- `recent-memory-design.md`：记录 recommendation rounds 的正式持久化来源。
- `api-design.md`：删除“已实现 SSE”的歧义；明确当前轮询和阶段锁边界。
- `roadmap-todo.md`：勾选本轮完成项，保留 V2 数据库和用户系统。
- `plans/README.md`：本计划完成后标记等待归档。
- verification record：记录命令、原始结果、故障演练、浏览器验收、未验证项。

- [ ] **Step 6：做交付前不确定性审计**

审计至少回答：

- 未实际模拟的文件系统错误是什么；
- 公网服务器状态是否已核查；
- provider abort 是否被真实供应商尊重；
- 旧音色数据是否完成显式选择和迁移；
- JSON 快照还剩哪些数据库替换前的固有限制。

- [ ] **Step 7：提交文档收口**

```powershell
git add docs/README.md docs/architecture/recent-memory-design.md docs/architecture/api-design.md docs/todos/roadmap-todo.md docs/plans/README.md docs/records/2026-07-10-v1-high-risk-stabilization-verification.md
git commit -m "收口V1高风险稳定化验证"
```

---

## 计划完成标准

只有同时满足以下条件，才允许宣布高风险稳定化完成并进入 V2：

- 旧快照和备份副本可完整加载，候选历史不丢失。
- 任何持久化失败都能被服务端日志、API 或 `/readyz` 感知。
- 构建失败必然非零退出，不存在旧 dist 冒充新构建。
- 默认部署不裸露无鉴权 API 到非回环地址。
- 测试不再写真实 storage。
- 中断任务重启后进入明确状态，不无限 generating，不自动重复付费。
- 媒体库与全局音色库在生产启动时有唯一、可解释的 source of truth。
- 同项目同阶段重复生成被阻止，模型超时会取消底层请求。
- 推荐近期记忆在重启后仍存在，fingerprint 只有一种语义。
- 删除、备份、ready 检查有故障路径测试。
- 全量测试、故障演练、浏览器验收均有证据记录；未验证项没有被写成通过。
