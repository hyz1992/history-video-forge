import { hasPassingNarrationScriptValidation } from "./narration-readiness.js";
import { DEFAULT_NARRATION_CREATIVE_SETTINGS, ResolvedGenerationConfigurationV1Schema } from "../../../../shared/src/index.js";
import { settingsFromResolvedNarration } from "./narration-readiness.js";
import { createHash } from "node:crypto";
import { canonicalStringify, hashProjectNarrationTtsSettings, hashNarrationSettings, ConfirmNarrationRequest, NarrationDurationBand, GenerationConfigurationV1 } from "../../../../shared/src/index.js";
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
  async sourceContext(projectId: string, ownerId: string) {
      return readNarrationSource(this.db, projectId, ownerId, this.client);
  }
  async confirmScript(ownerId: string, actorId: string, projectId: string, scriptId: string, sourceHash: string) {
      const action = async (client?: NarrationReadClient) => {
          const source = await readNarrationSource(this.db, projectId, ownerId, client);
          if (source.project.narrationTimingMode !== "narration_first_v1")
              throw new Error("narration_mode_unavailable");
          if (!source.script || source.script.id !== scriptId || source.project.activeScriptRecordId !== scriptId || source.script.projectId !== projectId)
              throw new Error("narration_source_conflict");
          if (!hasPassingNarrationScriptValidation(source.script.validationResultJson))
              throw new Error("script_validation_required");
          if (textHash(source.script.scriptText) !== sourceHash)
              throw new Error("narration_source_conflict");
          if (source.confirmation?.sourceTextSha256 === sourceHash)
              return source.confirmation;
          const value = { scriptRecordId: scriptId, projectId, sourceTextSha256: sourceHash, confirmedBy: actorId, confirmedAt: new Date() };
          if (client)
              return client.scriptConfirmation.upsert({ where: { scriptRecordId: scriptId }, create: value, update: value });
          this.db.scriptConfirmations.set(scriptId, value);
          return value;
      };
      return this.client ? this.client.$transaction(tx => action(tx)) : action();
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
  async saveReadyBundle(ownerId: string, input: NarrationRecord, initialSubtitle: NarrationSubtitleRevision, lease?: NarrationLease): Promise<NarrationRecord> {
    const record = NarrationRecord.parse(input), subtitle = NarrationSubtitleRevision.parse(initialSubtitle);
    if (record.status !== "ready" || !record.output) throw new Error("narration_ready_bundle_required");
    validateSubtitle(record, subtitle);
    if (record.output.initialSubtitleRevisionId !== subtitle.id) throw new Error("narration_initial_subtitle_mismatch");
    await this.projectForOwner(record.projectId, ownerId);
    const client = this.client;
    if (client) {
      await client.$transaction(async tx => {
        if (!await tx.project.findFirst({where:{id:record.projectId,ownerId,archivedAt:null}})) throw new Error("project_scope_denied");
        if (lease) await assertLease(this.db, record.generationRunId, lease, tx);
        const previous = await tx.narrationRecord.findUnique({where:{id:record.id}});
        validateReady(previous ? decode(previous) : null, record);
        const staged = await tx.narrationSubtitleRevision.findMany({ where: { narrationRecordId: record.id } });
        for (const revision of staged) validateSubtitle(record, decodeSubtitle(revision));
        await tx.narrationSubtitleRevision.create({data:encodeSubtitle(subtitle)});
        const result = await tx.narrationRecord.updateMany({where:{id:record.id,projectId:record.projectId,status:"generating"},data:encode(record)});
        if (result.count !== 1) throw new Error("narration_state_conflict");
      });
    } else {
      if (lease) await assertLease(this.db, record.generationRunId, lease);
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
  async hasProviderIntent(runId: string) {
      return this.client ? (await this.client.generationRunEvent.count({ where: { generationRunId: runId, eventType: "narration_provider_intent" } })) > 0 : (this.db.generationRunEvents.get(runId) ?? []).some(e => e.eventType === "narration_provider_intent");
  }
  async claimProviderIntent(ownerId: string, projectId: string, runId: string, lease: NarrationLease, requestKey: string, requestHash: string) {
      // Map没有数据库事务：捕获相关来源，所有异步校验后同步复查并写入intent。
      // 只比较语音投影，项目名、总revision、字幕和视觉配置不参与门禁。
      const mapSeal = () => {
          const project = this.db.projects.get(projectId), script = project?.activeScriptRecordId ? this.db.scriptRecords.get(project.activeScriptRecordId) : null;
          const row = [...this.db.projectGenerationConfigurations.values()].find(c => c.projectId === projectId);
          const configuration = row?.configurationJson as Partial<GenerationConfigurationV1> | undefined;
          const run = this.db.generationRuns.get(runId);
          return canonicalStringify({
            project: {
              id: project?.id,
              ownerId: project?.ownerId,
              archivedAt: project && "archivedAt" in project ? project.archivedAt : null,
              mode: project?.narrationTimingMode,
              activeScriptRecordId: project?.activeScriptRecordId,
            },
            script: script ? {
              id: script.id,
              projectId: script.projectId,
              text: script.scriptText,
              validation: script.validationResultJson,
            } : null,
            confirmation: script ? this.db.scriptConfirmations.get(script.id) : null,
            tts: {
              selection: configuration?.capabilities?.["tts.synthesize"],
              voice: configuration?.creative?.voice_profile_id,
              narration: configuration?.creative?.narration ?? DEFAULT_NARRATION_CREATIVE_SETTINGS,
            },
            run: run ? {
              id: run.id,
              projectId: run.projectId,
              operation: run.operation,
              snapshotId: run.runConfigurationSnapshotId,
              payload: run.dispatchPayloadJson,
              status: run.status,
              owner: run.dispatchLeaseOwner,
              claimCount: run.dispatchClaimCount,
            } : null,
            record: [...this.db.narrationRecords.values()].find(r => r.generationRunId === runId),
            snapshot: run ? this.db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId) : null,
          });
      };
      const action = async (client?: NarrationReadClient) => {
          const seal = client ? null : mapSeal();
          const source = await readNarrationSource(this.db, projectId, ownerId, client);
          const run = await assertLease(this.db, runId, lease, client);
          if (run.projectId !== projectId || run.operation !== "script.narration.generate")
              throw new Error("narration_source_conflict");
          const events = client ? await client.generationRunEvent.findMany({
              where: {
                  generationRunId: runId, eventType: "narration_provider_intent"
              }
          }) : (this.db.generationRunEvents.get(runId) ?? []).filter(e => e.eventType === "narration_provider_intent");
          if (events.length)
              return false;
          const row = client ? await client.narrationRecord.findFirst({
              where: {
                  generationRunId: runId, projectId
              }
          }) : null;
          const record = client ? row ? decode(row) : null : [...this.db.narrationRecords.values()].find(r => r.generationRunId === runId);
          const snapshot = client ? await client.runConfigurationSnapshot.findUnique({
              where: {
                  id: run.runConfigurationSnapshotId
              }
          }) : this.db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
          const payload = run.dispatchPayloadJson as Record<string, unknown>;
          if (!record ||
              record.projectId !== projectId ||
              record.status !== "generating" ||
              record.configurationSnapshotId !== snapshot?.id ||
              snapshot.projectId !== projectId ||
              snapshot.runId !== runId ||
              payload?.owner_id !== ownerId ||
              payload.narration_record_id !== record.id ||
              payload.source_script_record_id !== record.scriptRecordId ||
              payload.source_text_sha256 !== record.sourceTextSha256 ||
              typeof payload.source_text !== "string" ||
              textHash(payload.source_text) !== record.sourceTextSha256 ||
              payload.settings_sha256 !== record.settingsSha256 ||
              canonicalStringify(payload.settings) !== canonicalStringify(record.settings) ||
              payload.source_project_tts_settings_sha256 !== record.sourceProjectTtsSettingsSha256 ||
              payload.provider_request_key !== requestKey ||
              requestHash !== textHash(canonicalStringify({
              sourceText: payload.source_text, settings: record.settings
          })))
              throw new Error("narration_source_conflict");
          const frozen = ResolvedGenerationConfigurationV1Schema.parse(snapshot.resolvedConfigurationJson);
          if (canonicalStringify(settingsFromResolvedNarration(frozen, record.settings.voice)) !== canonicalStringify(record.settings) ||
              await hashNarrationSettings(record.settings) !== record.settingsSha256)
              throw new Error("narration_snapshot_conflict");
          if (source.project.narrationTimingMode !== "narration_first_v1" ||
              ("archivedAt" in source.project && source.project.archivedAt) ||
              !source.script ||
              source.project.activeScriptRecordId !== record.scriptRecordId ||
              source.script.id !== record.scriptRecordId ||
              source.script.projectId !== projectId ||
              !hasPassingNarrationScriptValidation(source.script.validationResultJson) ||
              !source.confirmation ||
              source.confirmation.projectId !== projectId ||
              source.confirmation.scriptRecordId !== record.scriptRecordId ||
              source.confirmation.sourceTextSha256 !== record.sourceTextSha256 ||
              textHash(source.script.scriptText) !== record.sourceTextSha256 ||
              await hashProjectNarrationTtsSettings(source.configuration?.configurationJson) !== record.sourceProjectTtsSettingsSha256)
              throw new Error("narration_stale");
          const event = {
              id: this.db.generateId(), generationRunId: runId, segmentId: null, eventType: "narration_provider_intent", eventJson: {
                  provider_request_key: requestKey, attempt_index: 0, request_fingerprint: requestHash, lease_owner: lease.owner, claim_count: lease.claimCount
              }, createdAt: new Date()
          };
          if (client)
              await client.generationRunEvent.create({
                  data: event
              });
          else {
              if (seal !== mapSeal())
                  throw new Error("narration_stale");
              const currentRun = this.db.generationRuns.get(runId);
              if (!currentRun ||
                  currentRun.status !== "running" ||
                  currentRun.dispatchLeaseOwner !== lease.owner ||
                  currentRun.dispatchClaimCount !== lease.claimCount ||
                  !currentRun.dispatchLeaseExpiresAt ||
                  currentRun.dispatchLeaseExpiresAt.getTime() <= Date.now())
                  throw new Error("narration_lease_lost");
              // 与最终复查之间无await；并发Map调用也不能创建第二条intent。
              if ((this.db.generationRunEvents.get(runId) ?? []).some(e => e.eventType === "narration_provider_intent"))
                  return false;
              this.db.generationRunEvents.set(runId, [...(this.db.generationRunEvents.get(runId) ?? []), event]);
          }
          return true;
      };
      return this.client ? this.client.$transaction(tx => action(tx)) : action();
  }
  async transitionCandidate(ownerId: string, projectId: string, id: string, status: "failed" | "unknown", errorCode: string, lease: NarrationLease) {
      const action = async (client?: NarrationReadClient) => {
          const source = await readNarrationSource(this.db, projectId, ownerId, client);
          void source;
          const row = client ? await client.narrationRecord.findFirst({ where: { id, projectId } }) : null;
          const previous = client ? row ? decode(row) : null : this.db.narrationRecords.get(id);
          if (!previous || previous.projectId !== projectId || previous.status !== "generating")
              return null;
          await assertLease(this.db, previous.generationRunId, lease, client);
          const next = NarrationRecord.parse({ ...previous, status, errorCode, updatedAt: new Date().toISOString() });
          if (client)
              await client.narrationRecord.update({ where: { id }, data: encode(next) });
          else
              this.db.narrationRecords.set(id, next);
          return next;
      };
      return this.client ? this.client.$transaction(tx => action(tx)) : action();
  }
  async cancel(ownerId: string, projectId: string, id: string) {
      const action = async (client?: NarrationReadClient) => {
          await readNarrationSource(this.db, projectId, ownerId, client);
          const row = client ? await client.narrationRecord.findFirst({ where: { id, projectId } }) : null;
          const previous = client ? row ? decode(row) : null : this.db.narrationRecords.get(id);
          if (!previous || previous.projectId !== projectId)
              throw new Error("narration_not_found");
          if (previous.status === "cancelled")
              return previous;
          if (previous.status !== "generating")
              throw new Error("narration_state_conflict");
          const now = new Date();
          const next = NarrationRecord.parse({ ...previous, status: "cancelled", updatedAt: now.toISOString() });
          if (client) {
              await client.narrationRecord.update({ where: { id }, data: encode(next) });
              await client.generationRun.updateMany({ where: { id: previous.generationRunId, status: { in: ["pending_dispatch", "running"] } }, data: { status: "failed", dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, updatedAt: now } });
          }
          else {
              this.db.narrationRecords.set(id, next);
              const run = this.db.generationRuns.get(previous.generationRunId);
              if (run && (run.status === "pending_dispatch" || run.status === "running"))
                  Object.assign(run, { status: "failed", dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, updatedAt: now });
          }
          const event = { id: this.db.generateId(), generationRunId: previous.generationRunId, segmentId: null, eventType: "narration_cancelled", eventJson: { record_id: id }, createdAt: now };
          if (client)
              await client.generationRunEvent.create({ data: event });
          else
              this.db.generationRunEvents.set(previous.generationRunId, [...(this.db.generationRunEvents.get(previous.generationRunId) ?? []), event]);
          return next;
      };
      return this.client ? this.client.$transaction(tx => action(tx)) : action();
  }
  async confirm(ownerId: string, actorId: string, projectId: string, inputRecord: NarrationRecord, request: ConfirmNarrationRequest) {
      const action = async (client?: NarrationReadClient) => {
          const source = await readNarrationSource(this.db, projectId, ownerId, client);
          const row = client ? await client.narrationRecord.findFirst({ where: { id: inputRecord.id, projectId } }) : null;
          const record = client ? row ? decode(row) : null : this.db.narrationRecords.get(inputRecord.id);
          if (!record || record.projectId !== projectId)
              throw new Error("narration_not_found");
          if (record.status !== "ready" && record.status !== "confirmed")
              throw new Error("narration_not_confirmed");
          if (canonicalStringify(record.output) !== canonicalStringify(inputRecord.output) || record.settingsSha256 !== inputRecord.settingsSha256)
              throw new Error("narration_source_conflict");
          const configuration = GenerationConfigurationV1.parse(source.configuration?.configurationJson);
          if (!source.script || !hasPassingNarrationScriptValidation(source.script.validationResultJson) || !source.confirmation || source.project.activeScriptRecordId !== record.scriptRecordId || source.script.id !== record.scriptRecordId || source.confirmation.sourceTextSha256 !== textHash(source.script.scriptText) || record.sourceTextSha256 !== textHash(source.script.scriptText) || record.sourceProjectTtsSettingsSha256 !== await hashProjectNarrationTtsSettings(configuration))
              throw new Error("narration_stale");
          if (record.sourceTextSha256 !== request.source_text_sha256 || record.settingsSha256 !== request.settings_sha256 || record.settingsSha256 !== await hashNarrationSettings(record.settings))
              throw new Error("narration_source_conflict");
          const run = client ? await client.generationRun.findUnique({ where: { id: record.generationRunId } }) : this.db.generationRuns.get(record.generationRunId);
          const snapshot = client ? await client.runConfigurationSnapshot.findUnique({ where: { id: record.configurationSnapshotId } }) : this.db.runConfigurationSnapshots.get(record.configurationSnapshotId);
          const payload = run?.dispatchPayloadJson as Record<string, unknown> | undefined;
          if (!run || run.projectId !== projectId || run.status !== "succeeded" || run.runConfigurationSnapshotId !== snapshot?.id || snapshot.projectId !== projectId || payload?.settings_sha256 !== record.settingsSha256 || payload?.source_text_sha256 !== record.sourceTextSha256 || canonicalStringify(payload?.settings) !== canonicalStringify(record.settings))
              throw new Error("narration_source_conflict");
          const frozen = ResolvedGenerationConfigurationV1Schema.parse(snapshot.resolvedConfigurationJson);
          if (canonicalStringify(settingsFromResolvedNarration(frozen, record.settings.voice)) !== canonicalStringify(record.settings) || payload?.source_project_tts_settings_sha256 !== record.sourceProjectTtsSettingsSha256)
              throw new Error("narration_snapshot_conflict");
          const band = durationBandFromSource(source.topic?.durationBandJson);
          if (canonicalStringify(band) !== canonicalStringify(request.target_duration_band_snapshot))
              throw new Error("narration_duration_band_conflict");
          const duration = record.output!.durationMs;
          if ((duration < band.minMs || duration > band.maxMs) && !request.accept_duration_outside_band)
              throw new Error("narration_duration_not_accepted");
          const active = source.project.activeNarrationRecordId ?? null;
          if (active === record.id && record.status === "confirmed" && canonicalStringify(record.acceptedDurationBandSnapshot) === canonicalStringify(band))
              return record;
          if (active !== request.expected_active_narration_record_id)
              throw new Error("narration_active_conflict");
          const now = new Date();
          const next = NarrationRecord.parse({ ...record, status: "confirmed", acceptedDurationBandSnapshot: band, confirmedAt: now.toISOString(), confirmedBy: actorId, updatedAt: now.toISOString() });
          const update = {
              activeNarrationRecordId: record.id, activeNarrationSubtitleRevisionId: active === record.id ? source.project.activeNarrationSubtitleRevisionId : record.output!.initialSubtitleRevisionId, updatedAt: now,
              ...(active !== record.id ? { activeStoryboardRecordId: null, activeAssetPlanRecordId: null, activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestStoryboardRunTraceJson: Prisma.DbNull, latestAssetPlanRunTraceJson: Prisma.DbNull, latestAssetsRunTraceJson: Prisma.DbNull, latestComposeRunTraceJson: Prisma.DbNull, latestRenderRunTraceJson: Prisma.DbNull } : {})
          };
          if (client) {
              const changed = await client.project.updateMany({ where: { id: projectId, ownerId, activeNarrationRecordId: active }, data: update });
              if (changed.count !== 1)
                  throw new Error("narration_active_conflict");
              await client.narrationRecord.update({ where: { id: record.id }, data: encode(next) });
          }
          else {
              this.db.narrationRecords.set(record.id, next);
              const mapUpdate = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
              Object.assign(source.project, mapUpdate);
          }
          const event = { id: this.db.generateId(), generationRunId: record.generationRunId, segmentId: null, eventType: "narration_confirmed", eventJson: { record_id: record.id, previous_active_id: active, accepted_duration_band: band, actor_id: actorId }, createdAt: now };
          if (client)
              await client.generationRunEvent.create({ data: event });
          else
              this.db.generationRunEvents.set(record.generationRunId, [...(this.db.generationRunEvents.get(record.generationRunId) ?? []), event]);
          return next;
      };
      return this.client ? this.client.$transaction(tx => action(tx)) : action();
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

export type NarrationLease = { owner: string; claimCount: number; };
type NarrationReadClient = Pick<AppPrismaClient, "project" | "scriptRecord" | "scriptConfirmation" | "projectGenerationConfiguration" | "topicPackage" | "narrationRecord" | "generationRun" | "runConfigurationSnapshot" | "generationRunEvent">;
const textHash = (text: string) => createHash("sha256").update(text).digest("hex");
export function durationBandFromSource(value: unknown): NarrationDurationBand {
  const band = value as { min_sec?: number; max_sec?: number ;} | null;
  return NarrationDurationBand.parse({ minMs: typeof band?.min_sec === "number" ? band.min_sec * 1000 : null, maxMs: typeof band?.max_sec === "number" ? band.max_sec * 1000 : null });
}
export async function readNarrationSource(db: DbClient, projectId: string, ownerId: string, client?: NarrationReadClient) {
  const project = client ? await client.project.findFirst({ where: { id: projectId, ownerId, archivedAt: null } }) : db.projects.get(projectId);
  if (!project || project.ownerId !== ownerId) throw new Error("project_scope_denied");
  const script = project.activeScriptRecordId ? client ? await client.scriptRecord.findUnique({ where: { id: project.activeScriptRecordId } }) : db.scriptRecords.get(project.activeScriptRecordId) : null;
  const configuration = client ? await client.projectGenerationConfiguration.findUnique({ where: { projectId } }) : [...db.projectGenerationConfigurations.values()].find(c => c.projectId === projectId);
  const confirmation = script ? client ? await client.scriptConfirmation.findUnique({ where: { scriptRecordId: script.id } }) : db.scriptConfirmations.get(script.id) : null;
  const topic = project.activeTopicPackageId ? client ? await client.topicPackage.findUnique({ where: { id: project.activeTopicPackageId } }) : db.topicPackages.get(project.activeTopicPackageId) : null;
  return { project, script, configuration, confirmation, topic };
}
async function assertLease(db: DbClient, runId: string, lease: NarrationLease, client?: NarrationReadClient) {
  const run = client ? await client.generationRun.findUnique({ where: { id: runId } }) : db.generationRuns.get(runId);
  if (!run || run.status !== "running" || run.dispatchLeaseOwner !== lease.owner || run.dispatchClaimCount !== lease.claimCount || !run.dispatchLeaseExpiresAt || run.dispatchLeaseExpiresAt.getTime() <= Date.now()) throw new Error("narration_lease_lost");
  return run;
}
