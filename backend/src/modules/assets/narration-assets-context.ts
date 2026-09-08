import { canonicalStringify, NarrationRecord, NarrationSubtitleRevision, AssetPlanV2, StoryboardPlanV2 } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import type { AppPrismaTransactionClient } from "../../db/prisma-client.types.js";
import { withStoryboardNarrationSource, NarrationSourceError, type StoryboardNarrationSource } from "../narration/narration-invalidation.js";
import { decodeNarrationRow, decodeSubtitle } from "../narration/narration.repository.js";

export interface NarrationAssetsIdentity {
  narration: StoryboardNarrationSource;
  assetPlanRecordId: string;
  assetPlanJson: string;
  subtitleRevisionJson: string;
}
/** 来源链与最后激活动作共用事务；无持久化时最后一次读取到写入之间没有 await。 */
export function withNarrationAssetsSource<T>(db: DbClient, projectId: string, ownerId: string,
  expected: NarrationAssetsIdentity | undefined,
  action: (state: NarrationAssetsState, tx?: AppPrismaTransactionClient) => T | Promise<T>,
): Promise<T> {
  return withStoryboardNarrationSource(db, projectId, ownerId, expected?.narration, async ({ source, identity, storyboard }, tx) => {
    if (!identity || !storyboard) throw new NarrationSourceError("narration_assets_source_missing");
    const planId = source.project.activeAssetPlanRecordId, subtitleId = source.project.activeNarrationSubtitleRevisionId;
    const plan = tx ? (planId ? await tx.assetPlanRecord.findUnique({ where: { id: planId } }) : null) : (planId ? db.assetPlanRecords.get(planId) : null);
    const narrationRow = tx ? await tx.narrationRecord.findUnique({ where: { id: identity.narrationRecordId } }) : null;
    const subtitleRow = tx && subtitleId ? await tx.narrationSubtitleRevision.findUnique({ where: { id: subtitleId } }) : null;
    const manifestId = source.project.activeAssetManifestRecordId;
    const activeManifest = tx ? (manifestId ? await tx.assetManifestRecord.findUnique({ where: { id: manifestId } }) : null) : (manifestId ? db.assetManifestRecords.get(manifestId) ?? null : null);
    const record = narrationRow ? decodeNarrationRow(narrationRow) : tx ? null : NarrationRecord.parse(db.narrationRecords.get(identity.narrationRecordId));
    const revision = subtitleRow ? decodeSubtitle(subtitleRow) : tx ? null : NarrationSubtitleRevision.parse(subtitleId ? db.narrationSubtitleRevisions.get(subtitleId) : null);
    if (!plan || !record || !revision || plan.projectId !== projectId || plan.storyboardRecordId !== storyboard.id || plan.scriptRecordId !== identity.scriptRecordId || plan.topicPackageId !== source.script?.topicPackageId || revision.projectId !== projectId || revision.narrationRecordId !== record.id || revision.audioHash !== identity.audioHash || revision.timingHash !== identity.timingHash) throw new NarrationSourceError("narration_assets_source_stale");
    const assetPlan = AssetPlanV2.parse(plan.planJson), storyboardPlan = StoryboardPlanV2.parse(storyboard.planJson);
    if (assetPlan.source_storyboard_record_id !== storyboard.id || assetPlan.source_script_record_id !== identity.scriptRecordId || assetPlan.source_topic_package_id !== plan.topicPackageId || assetPlan.narration_reference.narration_record_id !== record.id || assetPlan.narration_reference.audio_hash !== identity.audioHash || assetPlan.narration_reference.timing_map_hash !== identity.timingHash) throw new NarrationSourceError("narration_assets_source_stale");
    const frozen = { narration: identity, assetPlanRecordId: plan.id, assetPlanJson: canonicalStringify(plan.planJson), subtitleRevisionJson: canonicalStringify(revision) };
    if (expected && canonicalStringify(expected) !== canonicalStringify(frozen)) throw new NarrationSourceError("narration_assets_source_stale");
    return action({ identity: frozen, project: source.project, planRecord: plan, storyboardPlan, assetPlan, record, revision, activeManifest: activeManifest?.projectId === projectId && activeManifest.assetPlanRecordId === plan.id ? activeManifest : null }, tx);
  });
}
type NarrationAssetsState = {
  identity: NarrationAssetsIdentity;
  project: Awaited<ReturnType<typeof import("../narration/narration.repository.js").readNarrationSource>>["project"];
  planRecord: { id: string; projectId: string; storyboardRecordId: string; scriptRecordId: string; topicPackageId: string; planJson: unknown };
  storyboardPlan: StoryboardPlanV2;
  assetPlan: AssetPlanV2;
  record: NarrationRecord;
  revision: NarrationSubtitleRevision;
  activeManifest: { manifestJson: unknown } | null;
};
export function captureNarrationAssetsSource(db: DbClient, projectId: string, ownerId: string) {
  return withNarrationAssetsSource(db, projectId, ownerId, undefined, state => structuredClone(state));
}
