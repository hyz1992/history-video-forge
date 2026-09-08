import { createDbClient } from "../../../backend/src/db/client.js";
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_SUBTITLE_STYLE, hashNarrationSettings, type NarrationRecord } from '../../../shared/src/index.js';
import { normalizeNarrationTiming } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
import { NarrationBundleStorage } from '../../../backend/src/modules/narration/narration-bundle-storage.js';
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const now = '2026-09-06T10:00:00.000Z';
const roots: string[] = [];
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of disposers.splice(0))
    await close(); for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true }); });
type NativeFixtureOptions = { words?: Array<{ text: string; begin_index: number; end_index: number; begin_time: number; end_time: number }>; singleCharacterCues?: boolean };
async function fixture(options: NativeFixtureOptions = {}) {
    const path = await mkdtemp(join(tmpdir(), 'narration-bundle-'));
    roots.push(path);
    const audio = Buffer.alloc(5616044);
    audio.write('RIFF');
    audio.writeUInt32LE(5616036, 4);
    audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(24000, 24);
    audio.writeUInt32LE(48000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write('data', 36);
    audio.writeUInt32LE(5616000, 40);
    const settings = { model: 'qwen-audio-3.0-tts-plus', voice: 'qwen-audio-3.0-tts-plus-longyimuling', region: 'cn-beijing', protocol: 'dashscope_ws', parametersVersion: 'neutral-pcm24k-v1', tone: 'neutral', rate: 1, pitch: 1, volume: 50, sampleRate: 24000, format: 'pcm', textType: 'PlainText', wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: 'natural_paragraphs_single_task' } as const;
    const words = options.words ?? [{ text: '甲', begin_index: 0, end_index: 1, begin_time: 0, end_time: 6400 }, { text: '乙', begin_index: 1, end_index: 2, begin_time: 6400, end_time: 116000 }];
    const timingMap = normalizeNarrationTiming({ sourceText: '甲乙', audioHash: sha(audio), durationMs: 117000, sentences: [{ providerSentenceIndex: 0, originalText: '甲乙', normalizedText: '甲乙', words }] });
    const event = (name: string, output?: unknown) => ({ kind: 'json', elapsedMs: 0, data: { header: { event: name, task_id: 'task' }, payload: output === undefined ? {} : { output } } });
    const nativeEvents = [event('task-started'), event('result-generated', { type: 'sentence-begin', sentence: { index: 0 } }), { kind: 'audio', elapsedMs: 0, byteOffset: 0, byteLength: 5616000 }, event('result-generated', { type: 'sentence-end', sentence: { index: 0, words }, original_text: '甲乙', normalized_text: '甲乙' }), event('task-finished')];
    const record: NarrationRecord = { schemaVersion: 'narration_record_v1', id: 'n1', projectId: 'p1', scriptRecordId: 's1', generationRunId: 'run1', createdAt: now, updatedAt: now, sourceTextSha256: sha('甲乙'), spokenTextSha256: null, settingsSha256: await hashNarrationSettings(settings), sourceProjectTtsSettingsSha256: sha('settings'), textMappingVersion: 'narration-native-spans/v1', configurationSnapshotId: 'snap1', settings, timingSource: 'provider_native', providerTaskId: 'task', providerRequestId: null, status: 'generating', errorCode: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null, output: null };
    const subtitleSettings = { presetId: null, presetVersion: null, resolvedStyle: { ...DEFAULT_SUBTITLE_STYLE }, overrides: {}, lineBreak: { strategy: 'punctuation_and_length' as const, maxCharactersPerLine: 20, version: 'v1' }, resolverVersion: 'v1' };
    if (options.singleCharacterCues) { subtitleSettings.lineBreak.maxCharactersPerLine = 1; subtitleSettings.resolvedStyle.max_lines = 1; }
    return { path, store: new NarrationBundleStorage({ projectId: 'p1', storageRootDir: path }), input: { record, audio, timingMap, nativeEvents, subtitleSettings, subtitleRevisionId: 'sub1', createdAt: now } };
}
import { canonicalStringify, AssetManifestV2 } from "../../../shared/src/index.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { compileNarrationAssetPlan } from "../../../backend/src/modules/asset-planning/narration-reference-compiler.js";
import { importNarrationManifest } from "../../../backend/src/modules/assets/narration-manifest-importer.js";
import { createDashscopeImageToVideoProvider } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.js";
async function prepared(projectSettingsHash?: string, options: NativeFixtureOptions = {}) {
    const f = await fixture(options);
    if (projectSettingsHash)
        f.input.record.sourceProjectTtsSettingsSha256 = projectSettingsHash;
    const bundle = await f.store.commitInitial(f.input);
    const record = { ...bundle.record, status: "confirmed" as const, confirmedAt: now, confirmedBy: "owner", acceptedDurationBandSnapshot: { minMs: 100000, maxMs: 120000 } };
    const timingMap = f.input.timingMap;
    const narrationReference = { narration_record_id: record.id, audio_hash: record.output!.audio.sha256, timing_map_hash: sha(canonicalStringify(timingMap)), duration_ms: 117000 };
    const visual = { narrative_role: "opening", visual_intent: "城门", scene_description: "城门", visual_elements: ["门"], framing_hint: "wide", content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "api_video_beneficial" };
    const storyboard = projectStoryboardTiming({ timingMap, narrationReference, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [], segments: [0, 1].map(i => ({ ...visual, segment_id: "s" + i, order: i, start_boundary_id: timingMap.boundaries[i]!.id, end_boundary_id: timingMap.boundaries[i + 1]!.id })) } });
    const plan = compileNarrationAssetPlan({ sourceIds: { storyboardRecordId: "sb", scriptRecordId: "s1", topicPackageId: "t1" }, storyboard, narrationTiming: { timingMap, narrationReference }, draft: { script_text: "甲乙", estimated_duration_sec: 117, opening_span: "甲", ending_span: "乙", beat_trace: [], quote_trace: [] },
        globalDraft: { art_bible: { era_style: "古代", visual_tone: "写实", characters: [], locations: [], props: [], global_prompt_prefix: "古代", global_negative_prompts: [], consistency_notes: [] }, visual_budget: {}, downgrade_policy: {}, global_audio_strategy: {}, manual_review_notes: ["复核"] },
        segmentVisualRoutes: new Map(storyboard.segments.map(s => [s.segment_id, { segment_id: s.segment_id, segment_override: null, api_video_suitability: s.api_video_suitability, resolved_route: "api_video" as const, reason_code: "test" }])),
        chunks: [{ chunkIndex: 0, inputSegmentIds: ["s0", "s1"], draft: { planning_mode: "segment_intent_batch", budget_notes: [], segments: storyboard.segments.map((s, i) => ({ source_segment_id: s.segment_id, intents: [
                            { asset_kind: "image_still" as const, production_intent: "门", image_prompt: "门", video_prompt_reserve: "门", image_role: "anchor" as const, support_reason: null, risk_notes: ["核对"] },
                            { asset_kind: "video_clip" as const, production_intent: "推门", video_prompt: "推门", why_static_insufficient: "动作", risk_notes: ["核对"] },
                            { asset_kind: "render_motion_cue" as const, production_intent: "推进", risk_notes: ["缓慢"] },
                            ...(i ? [] : [{ asset_kind: "bgm_cue" as const, production_intent: "配乐", required_tags: ["弦乐"], mood_tags: ["紧张"], selection_label: "配乐", timing_basis: "tts" as const, scope: "global" as const, segment_ids: [], volume: 0.2, fade_in_sec: 0, fade_out_sec: 1, risk_notes: [] }])
                        ] })) } }] }).plan;
    return { ...f, record, storyboard, revision: bundle.initialSubtitleRevision, assetPlan: plan, assetPlanRecordId: "ap", storageRootDir: f.path };
}
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";
import { projectTtsHash } from "../../../backend/src/modules/narration/narration-invalidation.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import * as chunking from "../../../backend/src/modules/assets/tts-chunking.service.js";
import * as voices from "../../../backend/src/modules/assets/voice/voice-resolution.service.js";
async function runnable(options: NativeFixtureOptions = {}) {
    const db = createDbClient(), generate = db.generateId;
    db.generateId = vi.fn().mockReturnValueOnce("p1").mockImplementation(generate);
    const project = await createProject(db, { name: "Task9B" });
    const config = [...db.projectGenerationConfigurations.values()][0]!;
    const f = await prepared(projectTtsHash(config.configurationJson), options);
    Object.assign(project, { narrationTimingMode: "narration_first_v1", storageRootDir: f.path, activeTopicPackageId: "t1", activeScriptRecordId: "s1", activeNarrationRecordId: "n1", activeNarrationSubtitleRevisionId: "sub1", activeStoryboardRecordId: "sb", activeAssetPlanRecordId: "ap" });
    db.narrationRecords.set("n1", f.record);
    db.narrationSubtitleRevisions.set("sub1", f.revision);
    db.scriptRecords.set("s1", { id: "s1", projectId: "p1", topicPackageId: "t1", scriptText: "甲乙", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} } } as any);
    db.scriptConfirmations.set("s1", { scriptRecordId: "s1", projectId: "p1", sourceTextSha256: sha("甲乙"), confirmedAt: new Date(), confirmedBy: project.ownerId });
    db.topicPackages.set("t1", { id: "t1", projectId: "p1", durationBandJson: { min_sec: 100, max_sec: 120 } } as any);
    db.storyboardRecords.set("sb", { id: "sb", projectId: "p1", scriptRecordId: "s1", topicPackageId: "t1", planJson: f.storyboard } as any);
    db.assetPlanRecords.set("ap", { id: "ap", projectId: "p1", scriptRecordId: "s1", topicPackageId: "t1", storyboardRecordId: "sb", planJson: f.assetPlan } as any);
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }))
        db.providerModelCatalog.set(row.id, row);
    await seedGlobalVoiceProfiles(db);
    return { ...f, db, project };
}
import Database from "better-sqlite3";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
async function persistentRunnable() {
    const f = await runnable(), file = join(f.path, "test.db"), sql = new Database(file);
    applyAllDatabaseMigrations(sql);
    sql.close();
    const client = await createPrismaClient(file);
    disposers.push(() => client.$disconnect());
    await client.user.create({ data: { id: f.project.ownerId, username: "owner", displayName: "owner", passwordHash: "hash" } });
    await client.project.create({ data: { id: "p1", ownerId: f.project.ownerId, createdById: f.project.ownerId, name: "Task9B", storageKey: "p1", storageDisplayName: "Task9B", status: "asset_plan_ready", narrationTimingMode: "narration_first_v1" } });
    await client.topicPackage.create({ data: { id: "t1", projectId: "p1", title: "城门", selectedAngle: "选择", familyLabel: "f", scopeLabel: "s", coreConflict: "守城", strongScene: "门", packagingSeed: "选择", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { min_sec: 100, max_sec: 120 }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
    await client.scriptRecord.create({ data: { id: "s1", projectId: "p1", topicPackageId: "t1", scriptText: "甲乙", openingSpan: "甲", endingSpan: "乙", estimatedDurationSec: 117, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} } } });
    await client.storyboardRecord.create({ data: { id: "sb", projectId: "p1", topicPackageId: "t1", scriptRecordId: "s1", planJson: f.storyboard, validationResultJson: { decision: "pass" } } });
    await client.assetPlanRecord.create({ data: { id: "ap", projectId: "p1", topicPackageId: "t1", scriptRecordId: "s1", storyboardRecordId: "sb", planJson: f.assetPlan, validationResultJson: { decision: "pass" }, executionStateJson: {} } });
    const config = [...f.db.projectGenerationConfigurations.values()][0]!;
    await client.projectGenerationConfiguration.create({ data: config as any });
    await client.scriptConfirmation.create({ data: f.db.scriptConfirmations.get("s1")! });
    await client.project.update({ where: { id: "p1" }, data: { activeTopicPackageId: "t1", activeScriptRecordId: "s1", activeStoryboardRecordId: "sb", activeAssetPlanRecordId: "ap" } });
    await client.runConfigurationSnapshot.create({ data: { id: "snap1", projectId: "p1", stage: "script", operation: "script.narration.generate", runId: "run1", projectConfigurationRevision: 1, schemaVersion: "run_configuration_snapshot_v1", configurationHash: "a".repeat(64), resolvedConfigurationJson: {}, resolutionTraceJson: [], pricingVersionSetJson: [] } });
    await client.generationRun.create({ data: { id: "run1", projectId: "p1", operation: "script.narration.generate", idempotencyKey: "run1", payloadFingerprint: "a".repeat(64), runConfigurationSnapshotId: "snap1", dispatchPayloadJson: {}, status: "succeeded" } });
    f.db.firstAggregateWriter = await PrismaFirstAggregateWriter.create(client, f.project.ownerId);
    f.db.secondAggregateWriter = new PrismaSecondAggregateWriter(client, f.project.ownerId);
    f.db.thirdAggregateWriter = new PrismaThirdAggregateWriter(client);
    f.db.narrationPersistence.prismaClient = client;
    const repo = new NarrationRepository(f.db);
    await repo.createCandidate(f.project.ownerId, { ...f.record, status: "generating", output: null, spokenTextSha256: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null });
    await repo.saveReadyBundle(f.project.ownerId, { ...f.record, status: "ready", confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null }, f.revision);
    await client.narrationRecord.update({ where: { id: "n1" }, data: { status: "confirmed", confirmedAt: new Date(now), confirmedBy: f.project.ownerId, acceptedDurationBandSnapshotJson: f.record.acceptedDurationBandSnapshot! } });
    await client.project.update({ where: { id: "p1" }, data: { activeNarrationRecordId: "n1", activeNarrationSubtitleRevisionId: "sub1" } });
    f.db.narrationRecords.set("n1", f.record);
    return { ...f, client };
}
export { runnable, persistentRunnable };
