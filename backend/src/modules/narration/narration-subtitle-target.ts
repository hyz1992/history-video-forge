import { z } from 'zod';
import { canonicalStringify, GenerationConfigurationV1, NarrationSubtitleSettingsSnapshot } from '../../../../shared/src/index.js';
import type { DbClient } from '../../db/client.js';
import type { AppPrismaTransactionClient } from '../../db/prisma-client.types.js';
import { narrationTextHash } from './narration-readiness.js';
const Target = z.object({ schemaVersion: z.literal('narration_subtitle_target_v1'), targetId: z.string().min(1), narrationRecordId: z.string().min(1), settingsSnapshot: NarrationSubtitleSettingsSnapshot, settingsHash: z.string().regex(/^[a-f0-9]{64}$/), configurationHash: z.string().regex(/^[a-f0-9]{64}$/), builderVersion: z.string().min(1), state: z.enum(['pending', 'ready', 'failed']), revisionId: z.string().nullable(), manifestId: z.string().nullable() }).strict().refine(t => narrationTextHash(canonicalStringify(t.settingsSnapshot)) === t.settingsHash, { message: 'narration_subtitle_target_hash_invalid' });
export type NarrationSubtitleTarget = z.infer<typeof Target>;
export const SUBTITLE_TARGET_EVENT = 'narration_subtitle_target';
export function subtitleConfigurationHash(value: unknown) { const c = GenerationConfigurationV1.parse(value).creative; return narrationTextHash(canonicalStringify({ presetId: c.subtitle_style_preset_id, overrides: c.subtitle_style_overrides })); }
export function mapSubtitleTarget(db: DbClient, runId: string): NarrationSubtitleTarget | null {
    const rows = (db.generationRunEvents.get(runId) ?? []).filter(r => r.eventType === SUBTITLE_TARGET_EVENT).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    return rows[0] ? Target.parse(rows[0].eventJson) : null;
}
export async function readSubtitleTarget(db: DbClient, runId: string, tx?: Pick<AppPrismaTransactionClient, 'generationRunEvent'>): Promise<NarrationSubtitleTarget | null> {
    if (!tx)
        return mapSubtitleTarget(db, runId);
    const row = await tx.generationRunEvent.findFirst({ where: { generationRunId: runId, eventType: SUBTITLE_TARGET_EVENT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return row ? Target.parse(row.eventJson) : null;
}
/** 事务内追加单调序号时间；这是本地派生状态，不是供应商调用。 */
export async function appendSubtitleTarget(db: DbClient, runId: string, input: NarrationSubtitleTarget, tx?: AppPrismaTransactionClient) {
    const target = Target.parse(input);
    const previous = tx ? await tx.generationRunEvent.findFirst({ where: { generationRunId: runId, eventType: SUBTITLE_TARGET_EVENT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : [...(db.generationRunEvents.get(runId) ?? [])].filter(r => r.eventType === SUBTITLE_TARGET_EVENT).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const event = { id: db.generateId(), generationRunId: runId, segmentId: null, eventType: SUBTITLE_TARGET_EVENT, eventJson: target, createdAt: new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1)) };
    if (tx)
        await tx.generationRunEvent.create({ data: event });
    else
        db.generationRunEvents.set(runId, [...(db.generationRunEvents.get(runId) ?? []), event]);
    return target;
}
/** 已保存同一预设的更高版本不得被旧部署覆盖；相同版本内容变动同样拒绝。 */
export function assertSubtitleTargetVersion(previous: NarrationSubtitleTarget | null, next: NarrationSubtitleTarget) {
    if (!previous || previous.settingsHash === next.settingsHash)
        return;
    const a = previous.settingsSnapshot, b = next.settingsSnapshot;
    if (a.presetId === b.presetId && (a.presetVersion === b.presetVersion && previous.configurationHash === next.configurationHash || (a.presetVersion && b.presetVersion && BigInt(a.presetVersion.slice(1)) > BigInt(b.presetVersion.slice(1)))))
        throw new Error('narration_subtitle_resolver_stale');
}
export function mapSubtitleTargetHistory(db: DbClient, runId: string): NarrationSubtitleTarget[] {
    return (db.generationRunEvents.get(runId) ?? []).filter(r => r.eventType === SUBTITLE_TARGET_EVENT).map(r => Target.parse(r.eventJson));
}
export async function readSubtitleTargetHistory(db: DbClient, runId: string, tx: Pick<AppPrismaTransactionClient, 'generationRunEvent'>): Promise<NarrationSubtitleTarget[]> {
    return (await tx.generationRunEvent.findMany({ where: { generationRunId: runId, eventType: SUBTITLE_TARGET_EVENT } })).map(r => Target.parse(r.eventJson));
}
