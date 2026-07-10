import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL?.trim() || "file:../storage/history-video-forge.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
