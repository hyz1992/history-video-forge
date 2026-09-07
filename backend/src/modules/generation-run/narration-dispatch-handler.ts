import type { DbClient, GenerationRunRecord, RunConfigurationSnapshotRecord } from "../../db/client.js";
import type { GenerationRunRepository } from "./generation-run.repository.js";
import { NarrationProviderFact } from "../narration/narration-bundle-storage.js";
import { Prisma } from "../../generated/prisma/client.js";
import { hasPassingNarrationScriptValidation } from "../narration/narration-readiness.js";
import { evaluateNarrationCapabilityReadiness } from "../generation-cost/generation-capability-readiness.js";
import type { GenerationRunDispatchHandler } from "./generation-run-dispatcher.js";
import type { DashScopeNarrationProvider } from "../narration/providers/dashscope-narration-provider.js";
import { DashScopeNarrationProvider as RealProvider } from "../narration/providers/dashscope-narration-provider.js";
import { DashScopeSpeechWsClient, NarrationProviderError } from "../narration/providers/dashscope-speech-ws-client.js";
import { NarrationRepository } from "../narration/narration.repository.js";
import { NarrationDispatchPayload, ensureNarrationCandidate, narrationStorage } from "../narration/narration-run.service.js";
import { narrationTextHash, settingsFromResolvedNarration } from "../narration/narration-readiness.js";
import { ResolvedGenerationConfigurationV1Schema, canonicalStringify, hashNarrationSettings, hashProjectNarrationTtsSettings } from "../../../../shared/src/index.js";
import { getVoiceProfileById } from "../assets/voice/voice-profile.repository.js";
import { assertNarrationExecutionCompatibility } from "../narration/narration-execution-compatibility.js";
import { recordNarrationUsage } from "../generation-cost/usage-cost-recorder.js";
export type NarrationProvider = Pick<DashScopeNarrationProvider, "generate">;
function isTransientReadyPersistenceError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2034", "SQLITE_BUSY_SNAPSHOT"].includes(error.code)
        || error instanceof Prisma.PrismaClientInitializationError && ["P1001", "P1002", "P1008", "P1017"].includes(error.errorCode ?? "");
}

type StoredFact = { sha256: string; fact: NarrationProviderFact };
async function applyProviderFact(db: DbClient, repository: GenerationRunRepository, run: GenerationRunRecord, snapshot: RunConfigurationSnapshotRecord, stored: StoredFact, canceled: boolean) {
    const payload = NarrationDispatchPayload.parse(run.dispatchPayloadJson), fact = stored.fact;
    if (snapshot.runId !== run.id || snapshot.projectId !== run.projectId || fact.providerRequestKey !== payload.provider_request_key || fact.generationRunId !== run.id || fact.configurationSnapshotId !== snapshot.id || fact.sourceTextSha256 !== payload.source_text_sha256 || fact.settingsSha256 !== payload.settings_sha256) throw new Error("narration_fact_source_mismatch");
    const client = db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
    const eventId = (kind: string) => run.id + ":" + kind + ":" + stored.sha256;
    const exists = async (kind: string) => {
        const id=eventId(kind),event=client?await client.generationRunEvent.findUnique({where:{id}}):db.generationRunEvents.get(run.id)?.find(e=>e.id===id);
        if(!event)return false;
        if(event.generationRunId!==run.id||event.eventType!==kind||event.segmentId!==null||canonicalStringify(event.eventJson)!==canonicalStringify({fact_sha256:stored.sha256,schema_version:"narration_provider_fact_v1"}))throw new Error("narration_fact_event_invalid");
        return true;
    };
    const append = async (kind: string) => {
        const id=eventId(kind); if(await exists(kind))return;
        try { await repository.appendRunEvent({id,generationRunId:run.id,segmentId:null,eventType:kind,eventJson:{fact_sha256:stored.sha256,schema_version:"narration_provider_fact_v1"},createdAt:new Date()}); }
        catch(error){if(!await exists(kind))throw error;}
    };
    if(await exists("narration_provider_fact_applied"))return;
    await append("narration_provider_fact");
    await recordNarrationUsage({db,snapshot,runId:run.id,providerRequestKey:payload.provider_request_key,providerModelId:payload.pricing.provider_model_id,pricingVersion:payload.pricing.pricing_version,priceMicrosPer10k:payload.pricing.price_micros_per_10k_characters,sourceCharacters:payload.source_text.length,usageCharacters:fact.characters,receiptKind:fact.receiptKind==="none"?undefined:fact.receiptKind,status:canceled||fact.canceled?"canceled":fact.remoteOutcome==="completed"&&fact.errorCode===null?"succeeded":"failed",durationMs:fact.durationMs??undefined});
    await append("narration_provider_fact_applied");
}
/** 既有sweep只投影磁盘事实，不claim终态run、不迁移口播状态、不调用provider。 */
export async function reconcileNarrationProviderFacts(options:{db:DbClient;repository:GenerationRunRepository;storageBaseDir:string}) {
    const {db,repository}=options,client=db.narrationPersistence.prismaClient??db.firstAggregateWriter?.narrationPrismaClient;
    const ids=client?await client.generationRun.findMany({where:{operation:"script.narration.generate"},select:{id:true}}):[...db.generationRuns.values()].filter(r=>r.operation==="script.narration.generate");
    const errors: Array<{runId:string;reasonCode:string}>=[];
    for(const {id} of ids){
        try {
            const run=await repository.getRunById(id);if(!run)continue;
            const payload=NarrationDispatchPayload.parse(run.dispatchPayloadJson),project=client?await client.project.findUnique({where:{id:run.projectId}}):db.projects.get(run.projectId);
            if(!project)continue;
            const record=await new NarrationRepository(db).findByIdForOwner(run.projectId,project.ownerId,payload.narration_record_id),snapshot=await repository.getSnapshotById(run.runConfigurationSnapshotId);
            if(!record||!snapshot)continue;
            const facts=await narrationStorage(options,project as never).readProviderFacts({record});
            for(const fact of facts)await applyProviderFact(db,repository,run,snapshot,fact,record.status==="cancelled");
        } catch { errors.push({runId:id,reasonCode:"narration_fact_reconciliation_failed"}); }
    }
    return {errors};
}
const aborts = new Map<string, AbortController>();
export function cancelNarrationProvider(runId: string) { aborts.get(runId)?.abort(); }
export function createNarrationDispatchHandler(options: {
    storageBaseDir: string;
    provider?: NarrationProvider;
}): GenerationRunDispatchHandler {
    return async (run, context) => {
        const repo = new NarrationRepository(context.db), lease = { owner: run.dispatchLeaseOwner!, claimCount: run.dispatchClaimCount };
        let candidate: Awaited<ReturnType<typeof ensureNarrationCandidate>> | null = null, called = false, cancelRequested = false, providerCompleted = false;
        const phase: {current: "fact" | "usage" | "bundle" | "ready" | "state_read" | null} = {current:null};
        let storage: ReturnType<typeof narrationStorage> | null = null, savedFact: StoredFact | null = null, pendingFact: NarrationProviderFact | null = null;
        const fail = (reason: string) => ({ status: "failed" as const, reason_code: reason, message: reason });
        let snapshot: RunConfigurationSnapshotRecord | null = null;
        const requireSnapshot = () => {
            if (!snapshot) throw new Error("dispatch_snapshot_missing");
            return snapshot;
        };
        const parsed = NarrationDispatchPayload.safeParse(run.dispatchPayloadJson);
        if (!parsed.success)
            return fail("narration_dispatch_payload_invalid");
        const payload = parsed.data;
        const usage = (status: "submitted" | "succeeded" | "failed" | "canceled", characters: number | null, durationMs?: number, receiptKind?: "partial" | "final") => recordNarrationUsage({ db: context.db, snapshot: requireSnapshot(), runId: run.id, providerRequestKey: payload.provider_request_key, providerModelId: payload.pricing.provider_model_id, pricingVersion: payload.pricing.pricing_version, priceMicrosPer10k: payload.pricing.price_micros_per_10k_characters, sourceCharacters: payload.source_text.length, usageCharacters: characters, status, durationMs, receiptKind });
        const persistFact = async (values: Pick<NarrationProviderFact,"providerTaskId"|"providerRequestId"|"characters"|"receiptKind"|"remoteOutcome"|"errorCode"|"durationMs"|"canceled">) => {
            if(!candidate||!storage)throw new Error("narration_fact_source_mismatch");
            phase.current="fact";
            pendingFact=NarrationProviderFact.parse({schemaVersion:"narration_provider_fact_v1",projectId:run.projectId,generationRunId:run.id,configurationSnapshotId:requireSnapshot().id,providerRequestKey:payload.provider_request_key,sourceTextSha256:payload.source_text_sha256,settingsSha256:payload.settings_sha256,observedAt:new Date().toISOString(),...values});
            savedFact=await storage.commitProviderFact({record:candidate,fact:pendingFact});
        };
        // 诊断事件不是供应商事实或已应用标记；写入失败不得改变远端分类。
        const auditLocalFailure = async (localPhase: string, localCode: string) => {
            const fact = pendingFact ?? savedFact?.fact;
            try {
                await context.repository.appendRunEvent({id:run.id+":local-persistence:"+lease.claimCount+":"+localPhase,generationRunId:run.id,segmentId:null,eventType:"narration_local_persistence_failed",eventJson:{remote_outcome:fact?.remoteOutcome??"unknown",remote_error_code:fact?.errorCode??null,local_phase:localPhase,local_error_code:localCode},createdAt:new Date()});
            } catch { /* 诊断不能阻止结算，也不代表journal可恢复。 */ }
        };
        const journalFailure = async () => {
            const fact = pendingFact ?? savedFact?.fact;
            let localCode="narration_fact_persistence_failed";
            if(fact)try {
                await usage(cancelRequested||fact.canceled?"canceled":fact.remoteOutcome==="completed"&&fact.errorCode===null?"succeeded":"failed",fact.characters,fact.durationMs??undefined,fact.receiptKind==="none"?undefined:fact.receiptKind);
            } catch {localCode="narration_fact_and_usage_persistence_failed";}
            await auditLocalFailure("fact",localCode);
            const unknown=fact?.remoteOutcome==="unknown";
            const code=unknown?"narration_provider_unknown":fact?.errorCode??localCode;
            if(candidate)try {await repo.transitionCandidate(payload.owner_id,run.projectId,candidate.id,unknown?"unknown":"failed",code,lease);}catch{return fail("narration_lease_lost");}
            return unknown?{status:"needs_reconciliation" as const,reason_code:code,message:code}:fail(code);
        };
        try {
            // 整段恢复准备共用错误出口，不能在尚未读出本地事实时提前永久失败。
            snapshot = await context.repository.getSnapshotById(run.runConfigurationSnapshotId);
            if (!snapshot || snapshot.projectId !== run.projectId || snapshot.runId !== run.id) {
                try {
                    candidate = await repo.findByIdForOwner(run.projectId, payload.owner_id, payload.narration_record_id);
                    if (candidate)
                        await repo.transitionCandidate(payload.owner_id, run.projectId, candidate.id, "failed", "dispatch_snapshot_missing", lease);
                }
                catch { /* 已确认缺失/越权的快照不得因清理暂错转为可执行。 */ }
                return fail("dispatch_snapshot_missing");
            }
            candidate = await repo.findByIdForOwner(run.projectId, payload.owner_id, payload.narration_record_id);
            const source = await repo.sourceContext(run.projectId, payload.owner_id);
            const frozen = ResolvedGenerationConfigurationV1Schema.parse(snapshot.resolvedConfigurationJson);
            const frozenSettings = settingsFromResolvedNarration(frozen, payload.settings.voice);
            if (canonicalStringify(frozenSettings) !== canonicalStringify(payload.settings) || await hashNarrationSettings(frozenSettings) !== payload.settings_sha256 || narrationTextHash(payload.source_text) !== payload.source_text_sha256)
                throw new Error("narration_snapshot_conflict");
            candidate = await ensureNarrationCandidate({ db: context.db, generationRunRepository: context.repository }, run);
            storage = narrationStorage({ storageBaseDir: options.storageBaseDir }, source.project);
            const facts = await storage.readProviderFacts({record:candidate});
            for (const fact of facts) { savedFact=fact; phase.current="usage"; await applyProviderFact(context.db,context.repository,run,snapshot,fact,candidate.status==="cancelled"); }
            phase.current=null;
            if (candidate.status === "ready")
                return { status: "succeeded" };
            if (candidate.status !== "generating")
                return fail("narration_state_conflict");
            const recovered = await storage.recoverInitial({ record: candidate });
            if (recovered.status === "complete") {
                providerCompleted = true;
                phase.current = "ready";
                await repo.saveReadyBundle(payload.owner_id, recovered.bundle.record, recovered.bundle.initialSubtitleRevision, lease);
                return { status: "succeeded" };
            }
            if (facts.length) {
                const rank={unknown:0,not_started:1,failed:2,completed:3};
                const fact=[...facts].sort((a,b)=>rank[a.fact.remoteOutcome]-rank[b.fact.remoteOutcome]||(a.fact.receiptKind==="final"?1:0)-(b.fact.receiptKind==="final"?1:0)||(a.fact.characters??-1)-(b.fact.characters??-1)).at(-1)!.fact;
                const unknown=fact.remoteOutcome==="unknown";
                const code=unknown?"narration_provider_unknown":fact.errorCode??"narration_bundle_incomplete";
                await repo.transitionCandidate(payload.owner_id,run.projectId,candidate.id,unknown?"unknown":"failed",code,lease);
                return unknown?{status:"needs_reconciliation",reason_code:code,message:code}:fail(code);
            }
            if (await repo.hasProviderIntent(run.id)) {
                await usage("failed", null);
                await repo.transitionCandidate(payload.owner_id, run.projectId, candidate.id, "unknown", "narration_provider_unknown", lease);
                return { status: "needs_reconciliation", reason_code: "narration_provider_unknown", message: "既有供应商请求结果未知，禁止自动重发" };
            }
            const selected = frozen.resolved_capabilities["tts.synthesize"];
            const client = context.prismaClient ?? context.db.narrationPersistence.prismaClient;
            const catalog = client ? await client.providerModelCatalog.findMany() : [...context.db.providerModelCatalog.values()];
            const voice = await getVoiceProfileById(context.db, frozen.resolved_creative.voice.voice_profile_id ?? "", { ownerId: payload.owner_id });
            const settings = settingsFromResolvedNarration(frozen, voice?.provider_voice_id);
            assertNarrationExecutionCompatibility({ catalog: catalog as never, projectMode: source.project.narrationTimingMode as "narration_first_v1", operation: "script.narration.generate", model: catalog.find(m => m.id === selected.provider_model_id) as never, voice, settings, modelId: selected.model_id, providerKey: selected.provider_key, deploymentScope: settings.region });
            if (canonicalStringify(settings) !== canonicalStringify(payload.settings) || await hashNarrationSettings(settings) !== payload.settings_sha256 || narrationTextHash(payload.source_text) !== payload.source_text_sha256)
                throw new Error("narration_snapshot_conflict");
            if (!source.script || !hasPassingNarrationScriptValidation(source.script.validationResultJson) || source.script.id !== payload.source_script_record_id || source.script.projectId !== run.projectId || source.confirmation?.sourceTextSha256 !== payload.source_text_sha256 || narrationTextHash(source.script.scriptText) !== payload.source_text_sha256 || await hashProjectNarrationTtsSettings(source.configuration?.configurationJson) !== payload.source_project_tts_settings_sha256)
                throw new Error("narration_stale");
            const capabilityReady = evaluateNarrationCapabilityReadiness({ catalog: catalog as never, projectMode: source.project.narrationTimingMode as "narration_first_v1", operation: "script.narration.generate", model: catalog.find(m => m.id === selected.provider_model_id) as never, voice, settings, wsAdapterRegistered: true, credentialConfigured: Boolean(options.provider || process.env.ALIYUN_DASHSCOPE_API_KEY?.trim()) });
            if (!capabilityReady.ready)
                throw new Error(capabilityReady.reason ?? "narration_execution_incompatible");
            const fresh = await repo.claimProviderIntent(payload.owner_id, run.projectId, run.id, lease, payload.provider_request_key, narrationTextHash(canonicalStringify({ sourceText: payload.source_text, settings: payload.settings })));
            if (!fresh) {
                await usage("failed", null);
                await repo.transitionCandidate(payload.owner_id, run.projectId, candidate.id, "unknown", "narration_provider_unknown", lease);
                return { status: "needs_reconciliation", reason_code: "narration_provider_unknown", message: "既有供应商请求结果未知，禁止自动重发" };
            }
            await usage("submitted", null);
            const abort = new AbortController();
            aborts.set(run.id, abort);
            try {
                const beforeCall = await context.repository.getRunById(run.id);
                if (!beforeCall || beforeCall.status !== "running" || beforeCall.dispatchLeaseOwner !== lease.owner || beforeCall.dispatchClaimCount !== lease.claimCount)
                    throw new Error("narration_lease_lost");
                const provider = options.provider ?? new RealProvider({ client: new DashScopeSpeechWsClient({ apiKey: process.env.ALIYUN_DASHSCOPE_API_KEY! }) });
                called = true;
                const result = await provider.generate({ sourceText: payload.source_text, settings: payload.settings }, { signal: abort.signal });
                providerCompleted = true;
                await persistFact({providerTaskId:result.providerTaskId,providerRequestId:result.providerRequestId,characters:result.usageCharacters,receiptKind:result.usageCharacters===null?"none":"final",remoteOutcome:"completed",errorCode:null,durationMs:result.durationMs,canceled:abort.signal.aborted});
                if (abort.signal.aborted) {
                    phase.current="usage";await applyProviderFact(context.db,context.repository,run,snapshot,savedFact!,true);
                    throw new Error("narration_lease_lost");
                }
                phase.current = "bundle";
                const bundle = await storage.commitInitial({ record: { ...candidate, providerTaskId: result.providerTaskId, providerRequestId: result.providerRequestId }, audio: result.wav, timingMap: result.timingMap, nativeEvents: result.rawEvents, subtitleSettings: payload.subtitle_settings, subtitleRevisionId: candidate.id + "-initial", createdAt: new Date().toISOString() });
                // 完整本地产物先持久化；DB读取暂错后可由既有lease恢复，所有ready写仍受fencing保护。
                phase.current = "state_read";
                const current = await context.repository.getRunById(run.id);
                if (!current || current.status !== "running" || current.dispatchLeaseOwner !== lease.owner || current.dispatchClaimCount !== lease.claimCount || abort.signal.aborted) {
                    phase.current="usage";await applyProviderFact(context.db,context.repository,run,snapshot,savedFact!,abort.signal.aborted);
                    throw new Error("narration_lease_lost");
                }
                phase.current="usage";await applyProviderFact(context.db,context.repository,run,snapshot,savedFact!,abort.signal.aborted);
                phase.current = "ready";
                await repo.saveReadyBundle(payload.owner_id, bundle.record, bundle.initialSubtitleRevision, lease);
                return { status: "succeeded" };
            }
            finally {
                cancelRequested = abort.signal.aborted;
                aborts.delete(run.id);
            }
        }
        catch (error) {
            // 补账会改变phase；延期资格必须取自最初出错位置，而非补账后的阶段。
            const retryLocal = isTransientReadyPersistenceError(error) && (!called || phase.current === "ready" || Boolean(savedFact) && (phase.current === "usage" || phase.current === "state_read"));
            if(phase.current === "fact" && !savedFact)return journalFailure();
            const remoteUnknown = called && !providerCompleted && (!(error instanceof NarrationProviderError) || error.remoteOutcome === "unknown");
            if(phase.current === "state_read")await auditLocalFailure("state_read","narration_state_read_failed");
            const code = phase.current === "state_read" ? "narration_state_read_failed" : phase.current === "fact" ? "narration_fact_persistence_failed" : phase.current === "usage" ? "narration_usage_persistence_failed" : error instanceof NarrationProviderError ? error.code : phase.current === "bundle" ? "narration_bundle_write_failed" : phase.current === "ready" ? "narration_ready_persistence_failed" : called ? "narration_provider_unknown" : error instanceof Error ? error.message : "narration_dispatch_failed";
            if (called && phase.current !== "fact" && phase.current !== "usage") {
                try {
                    if(!savedFact){const e=error instanceof NarrationProviderError?error:null;await persistFact({providerTaskId:e?.receipt?.providerTaskId??null,providerRequestId:e?.receipt?.providerRequestId??null,characters:e?.receipt?.characters??null,receiptKind:e?.receipt?.kind??"none",remoteOutcome:e?.remoteOutcome??"unknown",errorCode:e?.code??"narration_provider_unknown",durationMs:null,canceled:cancelRequested});}
                    phase.current="usage";await applyProviderFact(context.db,context.repository,run,requireSnapshot(),savedFact!,cancelRequested);
                } catch(persistenceError) {
                    if(savedFact&&isTransientReadyPersistenceError(persistenceError))return {status:"deferred",reason_code:"narration_ready_persistence_retry",message:"口播供应商事实等待本地记账恢复"};
                    return journalFailure();
                }
            }
            let current: GenerationRunRecord | null;
            try {current=await context.repository.getRunById(run.id);} catch(readError) {
                if((savedFact||retryLocal)&&isTransientReadyPersistenceError(readError))return {status:"deferred",reason_code:"narration_ready_persistence_retry",message:"口播任务等待本地恢复"};
                return fail("narration_state_read_failed");
            }
            if (!current || current.status !== "running" || current.dispatchLeaseOwner !== lease.owner || current.dispatchClaimCount !== lease.claimCount)
                return fail("narration_lease_lost");
            if (retryLocal) {
                // 下次仍从冻结合同、本地产物和intent重新检查；延期不授予供应商重发许可。
                return { status: "deferred", reason_code: "narration_ready_persistence_retry", message: "口播任务等待本地恢复" };
            }
            if (candidate) {
                try {
                    await repo.transitionCandidate(payload.owner_id, run.projectId, candidate.id, remoteUnknown ? "unknown" : "failed", remoteUnknown ? "narration_provider_unknown" : code, lease);
                }
                catch {
                    return fail("narration_lease_lost");
                }
            }

            if (remoteUnknown) {
                return { status: "needs_reconciliation", reason_code: "narration_provider_unknown", message: "供应商调用结果未知，禁止自动重发" };
            }
            return fail(code);
        }
    };
}
