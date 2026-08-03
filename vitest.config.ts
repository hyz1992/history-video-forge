import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    env: {
      VITEST: "1",
      NODE_ENV: "test",
    },
    // STORAGE_ROOT_DIR 由 setup file 在每个 worker 内按 worker pid 设置，
    // 避免并行 worker 共享同一 storage 目录引发文件竞态。
    setupFiles: ["./tests/setup/worker-storage-root.ts"],
  },
});
