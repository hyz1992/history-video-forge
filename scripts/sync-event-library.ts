// 一次性脚本：把 storage/event-library/**/*.json 同步入库到 dev.db
// 用法：node --import tsx scripts/sync-event-library.ts

import { resolve } from "node:path";
import { createPrismaClient } from "../backend/src/db/prisma-client.js";
import { syncEventLibraryFromFiles } from "../backend/src/modules/event-library/event-library-sync.service.js";

async function main() {
  // 与 .env 的 DATABASE_URL=file:./storage/history-video-forge.db 对齐
  const dbPath = resolve(process.cwd(), "storage/history-video-forge.db");
  const storageRoot = resolve(process.cwd());

  console.log(`DB: ${dbPath}`);
  console.log(`storage root: ${storageRoot}`);

  const prisma = await createPrismaClient(`file:${dbPath}`);
  try {
    const result = await syncEventLibraryFromFiles(prisma, storageRoot);
    console.log("\n========== Sync 结果 ==========");
    console.log(`created: ${result.created}`);
    console.log(`updated: ${result.updated}`);
    console.log(`skipped: ${result.skipped}`);
    console.log(`archived: ${result.archived}`);
    if (result.errors.length > 0) {
      console.log(`errors (${result.errors.length}):`);
      for (const e of result.errors) {
        console.log(`  - ${e}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("未捕获错误:", e);
  process.exit(1);
});
