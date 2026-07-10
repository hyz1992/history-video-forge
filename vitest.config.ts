import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  test: {
    env: {
      VITEST: "1",
      NODE_ENV: "test",
      STORAGE_ROOT_DIR: resolve(tmpdir(), "story-video-forge2-vitest-storage", String(process.pid)),
    },
  },
});
