import { VersionedAssetManifest } from "./asset-manifest-v2.schema.js";
export * from "./asset-manifest-v1.schema.js";
export * from "./asset-manifest-v2.schema.js";
export const AssetManifest = VersionedAssetManifest;
export type AssetManifest = import("./asset-manifest-v2.schema.js").VersionedAssetManifest;
