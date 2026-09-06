import { Prisma } from "../../generated/prisma/client.js";
import { NarrationRecord, NarrationSubtitleRevision } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

type Row = Awaited<ReturnType<AppPrismaClient["narrationRecord"]["findUniqueOrThrow"]>>;
type SubtitleRow = Awaited<ReturnType<AppPrismaClient["narrationSubtitleRevision"]["findUniqueOrThrow"]>>;
function decode(row: Row): NarrationRecord {
  const { settingsJson, outputJson, initialSubtitleRevisionId, acceptedDurationBandSnapshotJson, ...rest } = row;
  const record = NarrationRecord.parse({ ...rest, settings: settingsJson, output: outputJson,
    acceptedDurationBandSnapshot: acceptedDurationBandSnapshotJson,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null });
  if ((record.output?.initialSubtitleRevisionId ?? null) !== initialSubtitleRevisionId) throw new Error("narration_initial_subtitle_mismatch");
  return record;
}
function encode(record: NarrationRecord) {
  const { settings, output, acceptedDurationBandSnapshot, ...rest } = record;
  return { ...rest, settingsJson: settings as never, outputJson: output === null ? Prisma.DbNull : output as never,
    initialSubtitleRevisionId: output?.initialSubtitleRevisionId ?? null,
    acceptedDurationBandSnapshotJson: acceptedDurationBandSnapshot === null ? Prisma.DbNull : acceptedDurationBandSnapshot as never,
    createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt), confirmedAt: record.confirmedAt ? new Date(record.confirmedAt) : null };
}
function decodeSubtitle(row: SubtitleRow): NarrationSubtitleRevision {
  const { srtJson, vttJson, ...rest } = row;
  return NarrationSubtitleRevision.parse({ ...rest, srt: srtJson, vtt: vttJson, createdAt: row.createdAt.toISOString() });
}
function encodeSubtitle(record: NarrationSubtitleRevision) {
  const { srt, vtt, ...rest } = record;
  return { ...rest, subtitleSettingsSnapshotJson: record.subtitleSettingsSnapshotJson as never,
    srtJson: srt as never, vttJson: vtt as never, createdAt: new Date(record.createdAt) };
}

/** Prisma 激活态只读数据库；Map 仅供无持久化的测试实例使用。 */
export class NarrationRepository {
  constructor(private readonly db: DbClient) {}
  private get client(): AppPrismaClient | undefined {
    const client = this.db.narrationPersistence.prismaClient ?? this.db.firstAggregateWriter?.narrationPrismaClient;
    if (!client && (this.db.firstAggregateWriter || this.db.secondAggregateWriter || this.db.thirdAggregateWriter)) throw new Error("narration_persistence_client_missing");
    return client;
  }
  async projectForOwner(projectId: string, ownerId: string) {
    const client = this.client;
    const project = client ? await client.project.findFirst({ where: { id: projectId, ownerId, archivedAt: null } }) : this.db.projects.get(projectId);
    if (!project || project.ownerId !== ownerId) throw new Error("project_scope_denied");
    return project;
  }
  async findByIdForOwner(projectId: string, ownerId: string, id: string): Promise<NarrationRecord | null> {
    await this.projectForOwner(projectId, ownerId);
    const client = this.client;
    if (client) { const row = await client.narrationRecord.findFirst({ where: { id, projectId } }); return row ? decode(row) : null; }
    const record = this.db.narrationRecords.get(id);
    return record?.projectId === projectId ? structuredClone(record) : null;
  }
  async findForRunForOwner(projectId: string, ownerId: string, scriptRecordId: string, generationRunId: string): Promise<NarrationRecord | null> {
    await this.projectForOwner(projectId, ownerId);
    const client = this.client;
    if (client) { const row = await client.narrationRecord.findFirst({ where: { projectId, scriptRecordId, generationRunId } }); return row ? decode(row) : null; }
    return structuredClone([...this.db.narrationRecords.values()].find(r => r.projectId === projectId && r.scriptRecordId === scriptRecordId && r.generationRunId === generationRunId) ?? null);
  }
  async findLatestForScriptForOwner(projectId: string, ownerId: string, scriptRecordId: string): Promise<NarrationRecord | null> {
    await this.projectForOwner(projectId, ownerId);
    const client = this.client;
    if (client) { const row = await client.narrationRecord.findFirst({ where: { projectId, scriptRecordId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }); return row ? decode(row) : null; }
    return structuredClone([...this.db.narrationRecords.values()].filter(r => r.projectId === projectId && r.scriptRecordId === scriptRecordId).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null);
  }
  async findSubtitleForOwner(projectId: string, ownerId: string, id: string): Promise<NarrationSubtitleRevision | null> {
    await this.projectForOwner(projectId, ownerId);
    const client = this.client;
    const row = client ? await client.narrationSubtitleRevision.findFirst({ where: { id, projectId } }) : null;
    const mirror = client ? null : this.db.narrationSubtitleRevisions.get(id);
    const subtitle = row ? decodeSubtitle(row) : mirror?.projectId === projectId ? NarrationSubtitleRevision.parse(mirror) : null;
    if (!subtitle) return null;
    const narration = await this.findByIdForOwner(projectId, ownerId, subtitle.narrationRecordId);
    // generating期间的暂存行不是可用字幕；历史坏行也必须经过完整来源校验。
    if (!narration?.output) return null;
    validateSubtitle(narration, subtitle);
    return subtitle;
  }
  async createCandidate(ownerId: string, input: NarrationRecord): Promise<NarrationRecord> {
    const record = NarrationRecord.parse(input);
    if (record.status !== "generating") throw new Error("narration_candidate_must_be_generating");
    await this.projectForOwner(record.projectId, ownerId);
    const client = this.client;
    if (client) {
      await client.$transaction(async tx => {
        const project = await tx.project.findFirst({where:{id:record.projectId,ownerId,archivedAt:null}});
        if (!project) throw new Error("project_scope_denied");
        const [script, run, snapshot] = await Promise.all([
          tx.scriptRecord.findUnique({where:{id:record.scriptRecordId}}),
          tx.generationRun.findUnique({where:{id:record.generationRunId}}),
          tx.runConfigurationSnapshot.findUnique({where:{id:record.configurationSnapshotId}}),
        ]);
        validateSource(record, script, run, snapshot);
        await tx.narrationRecord.create({data:encode(record)});
      });
    } else {
      validateSource(record, this.db.scriptRecords.get(record.scriptRecordId), this.db.generationRuns.get(record.generationRunId), this.db.runConfigurationSnapshots.get(record.configurationSnapshotId));
      if (this.db.narrationRecords.has(record.id) || [...this.db.narrationRecords.values()].some(r => r.generationRunId === record.generationRunId)) throw new Error("narration_unique_run");
      this.db.narrationRecords.set(record.id, structuredClone(record));
    }
    return structuredClone(record);
  }
  /** 初始字幕与完整bundle同事务提交；不修改Project active指针。 */
  async saveReadyBundle(ownerId: string, input: NarrationRecord, initialSubtitle: NarrationSubtitleRevision): Promise<NarrationRecord> {
    const record = NarrationRecord.parse(input), subtitle = NarrationSubtitleRevision.parse(initialSubtitle);
    if (record.status !== "ready" || !record.output) throw new Error("narration_ready_bundle_required");
    validateSubtitle(record, subtitle);
    if (record.output.initialSubtitleRevisionId !== subtitle.id) throw new Error("narration_initial_subtitle_mismatch");
    await this.projectForOwner(record.projectId, ownerId);
    const client = this.client;
    if (client) {
      await client.$transaction(async tx => {
        if (!await tx.project.findFirst({where:{id:record.projectId,ownerId,archivedAt:null}})) throw new Error("project_scope_denied");
        const previous = await tx.narrationRecord.findUnique({where:{id:record.id}});
        validateReady(previous ? decode(previous) : null, record);
        const staged = await tx.narrationSubtitleRevision.findMany({ where: { narrationRecordId: record.id } });
        for (const revision of staged) validateSubtitle(record, decodeSubtitle(revision));
        await tx.narrationSubtitleRevision.create({data:encodeSubtitle(subtitle)});
        const result = await tx.narrationRecord.updateMany({where:{id:record.id,projectId:record.projectId,status:"generating"},data:encode(record)});
        if (result.count !== 1) throw new Error("narration_state_conflict");
      });
    } else {
      validateReady(this.db.narrationRecords.get(record.id) ?? null, record);
      for (const revision of this.db.narrationSubtitleRevisions.values()) {
        if (revision.narrationRecordId === record.id) validateSubtitle(record, NarrationSubtitleRevision.parse(revision));
      }
      this.assertNewSubtitle(subtitle);
      this.db.narrationSubtitleRevisions.set(subtitle.id, structuredClone(subtitle));
      this.db.narrationRecords.set(record.id, structuredClone(record));
    }
    return structuredClone(record);
  }
  async appendSubtitleRevision(ownerId: string, input: NarrationSubtitleRevision): Promise<NarrationSubtitleRevision> {
    const subtitle = NarrationSubtitleRevision.parse(input);
    const record = await this.findByIdForOwner(subtitle.projectId, ownerId, subtitle.narrationRecordId);
    if (!record?.output) throw new Error("narration_ready_bundle_required");
    validateSubtitle(record, subtitle);
    const client = this.client;
    if (client) {
      await client.$transaction(async tx => {
        if (!await tx.project.findFirst({where:{id:subtitle.projectId,ownerId,archivedAt:null}})) throw new Error("project_scope_denied");
        await tx.narrationSubtitleRevision.create({data:encodeSubtitle(subtitle)});
      });
    } else { this.assertNewSubtitle(subtitle); this.db.narrationSubtitleRevisions.set(subtitle.id, structuredClone(subtitle)); }
    return structuredClone(subtitle);
  }
  private assertNewSubtitle(record: NarrationSubtitleRevision) {
    if (this.db.narrationSubtitleRevisions.has(record.id) || [...this.db.narrationSubtitleRevisions.values()].some(r => r.narrationRecordId === record.narrationRecordId && r.subtitleSettingsHash === record.subtitleSettingsHash && r.builderVersion === record.builderVersion)) throw new Error("narration_subtitle_unique_revision");
  }
}
function validateSource(record: NarrationRecord, script: {projectId:string} | null | undefined, run: {projectId:string; runConfigurationSnapshotId:string} | null | undefined, snapshot: {projectId:string} | null | undefined) {
  if (script?.projectId !== record.projectId || run?.projectId !== record.projectId || snapshot?.projectId !== record.projectId || run.runConfigurationSnapshotId !== record.configurationSnapshotId) throw new Error("narration_source_project_mismatch");
}
function validateReady(previous: NarrationRecord | null, record: NarrationRecord) {
  if (!previous || previous.status !== "generating") throw new Error("narration_state_conflict");
  for (const key of ["id", "projectId", "scriptRecordId", "generationRunId", "configurationSnapshotId", "schemaVersion", "sourceTextSha256", "settingsSha256", "sourceProjectTtsSettingsSha256", "textMappingVersion", "timingSource", "createdAt", "settings"] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(record[key])) throw new Error("narration_source_immutable");
  }
}
function validateSubtitle(record: NarrationRecord, subtitle: NarrationSubtitleRevision) {
  if (subtitle.projectId !== record.projectId || subtitle.narrationRecordId !== record.id || subtitle.audioHash !== record.output?.audio.sha256 || subtitle.timingHash !== record.output?.timingMap.sha256) throw new Error("narration_subtitle_source_mismatch");
}
