import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";

const db = new Database("./storage/history-video-forge.db", { readonly: true });

// 最新创建的项目
const projects = db.prepare(`
  SELECT p.id, p.name, p.ownerId, p.status, p.storageKey, p.activeRenderJobRecordId,
         u.username AS owner_username
  FROM Project p LEFT JOIN User u ON u.id = p.ownerId
  WHERE p.archivedAt IS NULL
  ORDER BY p.createdAt DESC LIMIT 5
`).all();

console.log("=== 最新 5 个项目 ===");
for (const p of projects) {
  console.log("\n--- project:", p.name, "---");
  console.log("  id:", p.id);
  console.log("  storageKey:", p.storageKey);
  console.log("  status:", p.status);
  console.log("  activeRenderJobRecordId:", p.activeRenderJobRecordId);
  console.log("  expected dir (UUID):", `storage/projects/${p.storageKey}`, existsSync(`storage/projects/${p.storageKey}`) ? "EXISTS" : "MISSING");

  if (p.activeRenderJobRecordId) {
    const rec = db.prepare("SELECT id, status, outputArtifactJson FROM RenderJobRecord WHERE id = ?").get(p.activeRenderJobRecordId);
    if (rec?.outputArtifactJson) {
      const artifact = JSON.parse(rec.outputArtifactJson);
      console.log("  render status:", rec.status);
      console.log("  file_uri:", artifact.file_uri);
      // 尝试找到文件真实位置
      const candidates = [
        `storage/projects/${p.storageKey}/${artifact.file_uri}`,
        `storage/${artifact.file_uri}`,
      ];
      for (const c of candidates) {
        console.log(`    check [${c}]:`, existsSync(c) ? "EXISTS" : "MISSING");
      }
    } else {
      console.log("  render record has NO outputArtifactJson");
    }
  }
}

db.close();
