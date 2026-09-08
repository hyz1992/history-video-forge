import { VersionedAssetPlan } from "./asset-plan-v2.schema.js";
export * from "./asset-plan-v1.schema.js";
export * from "./asset-plan-v2.schema.js";
export const AssetPlan = VersionedAssetPlan;
export type AssetPlan = import("./asset-plan-v2.schema.js").VersionedAssetPlan;
