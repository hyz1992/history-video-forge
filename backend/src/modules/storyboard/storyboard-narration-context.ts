import { createHash } from "node:crypto";
import { canonicalStringify, NarrationReference, NarrationTimingMapV1 } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { NarrationRepository } from "../narration/narration.repository.js";
import { NarrationBundleStorage } from "../narration/narration-bundle-storage.js";
import { NarrationSourceError, type StoryboardNarrationSource } from "../narration/narration-invalidation.js";
import type { StoryboardTimingContext } from "./storyboard-timing-projector.js";

export function verifyStoryboardNarrationContext(value: StoryboardTimingContext, sourceText?: string) {
  const timingMap = NarrationTimingMapV1.parse(value.timingMap);
  const narrationReference = NarrationReference.parse(value.narrationReference);
  const hash = createHash("sha256").update(canonicalStringify(timingMap)).digest("hex");
  if (narrationReference.audio_hash !== timingMap.audioHash || narrationReference.timing_map_hash !== hash ||
    narrationReference.duration_ms !== timingMap.durationMs || sourceText !== undefined && sourceText !== timingMap.sourceText)
    throw new NarrationSourceError("narration_stale");
  return { timingMap, narrationReference };
}
/** 必须从已确认record的完整bundle读取；调用者在最后磁盘await后仍复查Task6来源门禁。 */
export async function loadStoryboardNarrationTiming(db: DbClient, projectId: string, ownerId: string,
  expected: StoryboardNarrationSource | null, storageRootDir: string) {
  if (!expected) return undefined;
  const repository = new NarrationRepository(db);
  await repository.projectForOwner(projectId, ownerId);
  const record = await repository.findByIdForOwner(projectId, ownerId, expected.narrationRecordId);
  if (!record || record.status !== "confirmed" || record.scriptRecordId !== expected.scriptRecordId ||
    record.sourceTextSha256 !== expected.sourceTextSha256 || !record.output || record.output.audio.sha256 !== expected.audioHash ||
    record.output.timingMap.sha256 !== expected.timingHash) throw new NarrationSourceError("narration_stale");
  const bytes = await new NarrationBundleStorage({ projectId, storageRootDir }).readFile({ record, kind: "timing" });
  const context = verifyStoryboardNarrationContext({ timingMap: JSON.parse(bytes.toString("utf8")), narrationReference: {
    narration_record_id: record.id, audio_hash: record.output.audio.sha256, timing_map_hash: record.output.timingMap.sha256,
    duration_ms: record.output.durationMs } });
  if (createHash("sha256").update(context.timingMap.sourceText).digest("hex") !== expected.sourceTextSha256)
    throw new NarrationSourceError("narration_stale");
  return context;
}
