/**
 * vitest setup：为每个 worker 进程设置唯一的 STORAGE_ROOT_DIR。
 *
 * 根因：vitest.config.ts 的 env 在 main thread 求值，process.pid 是 main pid，
 * 所有 fork worker 继承同一 STORAGE_ROOT_DIR，导致并行测试文件共享 storage 目录，
 * 引发 db-snapshot.json / 持久化文件竞态（JSON 截断）。
 *
 * 修复：在 worker 内（setupFiles 在每个 worker 执行一次）用 worker 的 pid
 * 重新设置 STORAGE_ROOT_DIR。forks 模式下每个 worker 是独立子进程，pid 唯一。
 *
 * 对不传 storageBaseDir 的测试（如 topic-runtime-recommendation 的 buildApp()）
 * 生效；传了 storageBaseDir 的测试不受影响（app.ts L151 优先用 storageBaseDir）。
 */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.STORAGE_ROOT_DIR = resolve(
  tmpdir(),
  "story-video-forge2-vitest-storage",
  `worker-${process.pid}`,
);
