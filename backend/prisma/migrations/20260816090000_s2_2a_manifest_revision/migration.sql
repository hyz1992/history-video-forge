-- S2-2A 任务 6：AssetManifestRecord 增加乐观并发版本号（accept-fallback 原子 CAS）。
-- revision 默认 1；casUpsertAssetManifest 在 revision 匹配时更新并递增。

ALTER TABLE "AssetManifestRecord" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
