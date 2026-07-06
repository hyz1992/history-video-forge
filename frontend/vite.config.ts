import { resolve } from "node:path";

import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, ".."), "");
  const backendPort = env.SERVER_PORT ?? "3000";

  return {
    root: resolve(__dirname),
    plugins: [vue()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
