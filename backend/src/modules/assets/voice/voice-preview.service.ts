import type { DbClient, GenerationRunRecord, RunConfigurationSnapshotRecord, UsageCostRecordRecord } from "../../../db/client.js";
import { priceGenerationWorkload, type PricingWorkloadItem } from "../../generation-cost/pricing.service.js";
import { listProviderModelCatalog } from "../../generation-cost/provider-model-catalog.repository.js";
import { checkAndHandleOverrun } from "../../generation-cost/usage-cost-recorder.js";
import { createToneWavBuffer } from "../providers/audio-fixture.js";
import { resolveProviderVoice } from "./provider-voice-resolution.service.js";
import {
  getVoiceProfileById,
  updateVoiceProfileProviderState,
} from "./voice-profile.repository.js";

/**
 * S2-2B 试听执行服务（详细设计 §6.3/§9.3）。
 *
 * - cached：档案已有 preview_audio_uri → 直接返回（零费用）。
 * - 真实凭据：resolveProviderVoice（设计音色/就绪）→ DashScope TTS 合成
 *   preview_text → base64 data URI 回写档案。
 * - 无凭据（stub/fake）：createToneWavBuffer 合成占位音频（测试/演示），
 *   只回写 preview_audio_uri，不改 provider_status。
 * - 调用方（routes/dispatch handler）负责可见性、付费闸门与 quote 协议；
 *   本服务是内部执行（档案 id 已授权）。
 */

export interface ExecuteVoicePreviewInput {
  db: DbClient;
  voiceProfileId: string;
}

export interface ExecuteVoicePreviewResult {
  preview_audio_uri: string;
  source: "cached" | "generated";
  provider_voice_id: string | null;
  /** 真实 provider 是否参与（false = fake 占位）。 */
  usedRealProvider: boolean;
  /** 实际合成模型（与报价/usage 同源；fake 路径为空）。 */
  synthesis_model: string | null;
}

export async function executeVoicePreview(
  input: ExecuteVoicePreviewInput,
): Promise<ExecuteVoicePreviewResult> {
  const { db, voiceProfileId } = input;
  const profile = await getVoiceProfileById(db, voiceProfileId);
  if (!profile || profile.provider_status === "deleted") {
    throw new Error("voice_profile_unavailable");
  }
  if (profile.preview_audio_uri) {
    return {
      preview_audio_uri: profile.preview_audio_uri,
      source: "cached",
      provider_voice_id: profile.provider_voice_id,
      usedRealProvider: false,
      synthesis_model: null,
    };
  }

  const apiKey = process.env.ALIYUN_DASHSCOPE_API_KEY?.trim();
  if (apiKey) {
    const resolved = await resolveProviderVoice({
      db,
      localVoiceProfileId: voiceProfileId,
      apiKey,
      baseUrl: process.env.ALIYUN_DASHSCOPE_BASE_URL,
    });
    // P1-1（外部审查）：试听合成必须与报价/usage 使用同一模型——解析出的
    // tts.synthesize 默认模型（服务端 env TTS 模型，与正式 TTS 生成同源）。
    // 设计音色档案的 target_model（qwen3-tts-vd）只承担音色设计 API，不参与
    // 试听合成计价（目录无其计价条目，避免报价/执行/usage 三者不一致漏计费）。
    const synthesisModel =
      process.env.ALIYUN_DASHSCOPE_TTS_MODEL?.trim() || "qwen3-tts-instruct-flash";
    const audioBase64 = await synthesizeWithDashscope({
      apiKey,
      baseUrl: process.env.ALIYUN_DASHSCOPE_BASE_URL,
      model: synthesisModel,
      providerVoiceId: resolved.providerVoiceId,
      text: profile.preview_text,
    });
    const uri = `data:audio/wav;base64,${audioBase64}`;
    // resolveProviderVoice 已回写 provider_status/provider_voice_id；
    // 这里补写 preview_audio_uri（幂等，同值）。
    await updateVoiceProfileProviderState(db, voiceProfileId, {
      provider_status: resolved.providerVoiceId ? "ready" : profile.provider_status,
      preview_audio_uri: uri,
    });
    return {
      preview_audio_uri: uri,
      source: "generated",
      provider_voice_id: resolved.providerVoiceId,
      usedRealProvider: true,
      synthesis_model: synthesisModel,
    };
  }

  // fake 占位：只回写音频，不改 provider_status（避免伪造"设计完成"）
  const audioBase64 = createToneWavBuffer({ durationSec: 2 }).toString("base64");
  const uri = `data:audio/wav;base64,${audioBase64}`;
  await updateVoiceProfileProviderState(db, voiceProfileId, {
    provider_status: profile.provider_status,
    preview_audio_uri: uri,
  });
  return {
    preview_audio_uri: uri,
    source: "generated",
    provider_voice_id: profile.provider_voice_id,
    usedRealProvider: false,
    synthesis_model: null,
  };
}

/** DashScope TTS 单次同步合成（试听用；async disable + 下载音频）。 */
async function synthesizeWithDashscope(input: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  providerVoiceId: string;
  text: string;
}): Promise<string> {
  const baseUrl = (input.baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "disable",
    },
    body: JSON.stringify({
      model: input.model,
      input: { text: input.text, voice: input.providerVoiceId },
      parameters: { format: "wav", sample_rate: 24000 },
    }),
  });
  const raw = (await response.json()) as {
    output?: { audio?: { url?: string } };
  };
  if (!response.ok || !raw.output?.audio?.url) {
    throw new Error(`voice preview TTS failed: ${response.status}`);
  }
  const audio = await fetch(raw.output.audio.url);
  if (!audio.ok) {
    throw new Error(`voice preview audio download failed: ${audio.status}`);
  }
  return Buffer.from(await audio.arrayBuffer()).toString("base64");
}

// --- voice.preview usage 记账（与 9A/9B 同款幂等键 + overrun 语义） -----------

export interface RecordVoicePreviewUsageInput {
  db: DbClient;
  snapshot: RunConfigurationSnapshotRecord;
  runId: string;
  voiceProfileId: string;
  providerKey: string;
  modelId: string;
  /** 是否发生过设计请求（provider_status=missing 时报价包含 request 项）。 */
  designRequested: boolean;
  characterCount: number;
  status: "succeeded" | "failed";
  durationMs?: number;
}

/** 试听 usage：design request（attempt 0）+ tts_character 合成（attempt 1）。 */
export async function recordVoicePreviewUsage(
  input: RecordVoicePreviewUsageInput,
): Promise<void> {
  const { db, snapshot } = input;
  const catalog = listProviderModelCatalog(db);
  const entry = catalog.find(
    (item) => item.capability === "tts.synthesize" && item.providerKey === input.providerKey && item.modelId === input.modelId,
  );
  const activeCatalog =
    entry && entry.status === "active"
      ? catalog
      : catalog.map((item) => (item.id === entry?.id ? { ...item, status: "active" as const } : item));

  const attempts: Array<{ attemptIndex: number; workload: PricingWorkloadItem }> = [];
  if (input.designRequested) {
    attempts.push({
      attemptIndex: 0,
      workload: {
        capability: "tts.synthesize",
        provider_model_id: entry?.id ?? "",
        operation: "voice.preview",
        unit_type: "request",
        request_count: 1,
      },
    });
  }
  attempts.push({
    attemptIndex: attempts.length,
    workload: {
      capability: "tts.synthesize",
      provider_model_id: entry?.id ?? "",
      operation: "voice.preview",
      unit_type: "tts_character",
      character_count: input.characterCount,
    },
  });

  for (const attempt of attempts) {
    let estimatedCostMicros = "0";
    if (entry) {
      const priced = priceGenerationWorkload({
        catalog: activeCatalog,
        blockedProviderModelIds: [],
        workload: [attempt.workload],
      });
      if (priced.ok) {
        estimatedCostMicros = priced.value.items[0]?.estimated_cost_micros ?? "0";
      }
    }

    const providerRequestKey = `voice-preview:${input.voiceProfileId}`;
    const now = new Date();
    const record: UsageCostRecordRecord = {
      id: db.generateId(),
      runConfigurationSnapshotId: snapshot.id,
      assetProviderJobRecordId: null,
      interactionId: null,
      capability: "tts.synthesize",
      providerKey: input.providerKey,
      modelId: input.modelId,
      providerRequestKey,
      attemptIndex: attempt.attemptIndex,
      status: input.status,
      unitType: attempt.workload.unit_type,
      inputUnits: null,
      outputUnits:
        attempt.workload.unit_type === "tts_character"
          ? input.characterCount
          : 1,
      estimatedCostMicros,
      actualCostMicros: input.status === "succeeded" ? estimatedCostMicros : null,
      costBasis: "estimate",
      durationMs: input.durationMs ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if (db.thirdAggregateWriter) {
      await db.thirdAggregateWriter.saveUsageCostRecord(record);
    }
    db.usageCostRecords.set(record.id, record);

    await checkAndHandleOverrun(
      {
        db,
        snapshot,
        runId: input.runId,
        capability: "tts.synthesize",
        providerKey: input.providerKey,
        modelId: input.modelId,
        disableCatalog: true,
      },
      record,
    );
  }
}

/** dispatch handler 执行体（与 run 上下文解耦，便于 fake 路径复用）。 */
export async function runVoicePreviewDispatch(input: {
  db: DbClient;
  run: GenerationRunRecord;
  snapshot: RunConfigurationSnapshotRecord;
  voiceProfileId: string;
}): Promise<{ status: "succeeded" | "failed"; body: Record<string, unknown> }> {
  const { db, run, snapshot, voiceProfileId } = input;
  const profile = await getVoiceProfileById(db, voiceProfileId);
  if (!profile || profile.provider_status === "deleted") {
    return { status: "failed", body: { error: "voice_profile_unavailable" } };
  }
  const startedAt = Date.now();
  try {
    const result = await executeVoicePreview({ db, voiceProfileId });
    // P2-2（外部审查）：付费试听成功同样写业务审计（与 fake 路径同 action）
    const auditId = db.generateId();
    db.auditLogs.set(auditId, {
      id: auditId,
      actorUserId: run.userId,
      projectId: snapshot.projectId,
      action: "voice.profile_previewed",
      targetType: "voice_profile",
      targetId: voiceProfileId,
      metadataJson: { source: result.source, used_real_provider: result.usedRealProvider },
      createdAt: new Date(),
    });
    // P1-1：usage 的合成模型与报价/执行同源（默认 TTS 模型），
    // 目录可计价；设计请求（target_model）保持 unbounded 语义。
    await recordVoicePreviewUsage({
      db,
      snapshot,
      runId: run.id,
      voiceProfileId,
      providerKey: profile.provider_name,
      modelId: result.synthesis_model ?? "qwen3-tts-instruct-flash",
      designRequested: profile.provider_status === "missing",
      characterCount: profile.preview_text.length,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "succeeded",
      body: {
        preview_audio_uri: result.preview_audio_uri,
        source: result.source,
        provider_voice_id: result.provider_voice_id,
      },
    };
  } catch (error) {
    await recordVoicePreviewUsage({
      db,
      snapshot,
      runId: run.id,
      voiceProfileId,
      providerKey: profile.provider_name,
      modelId: process.env.ALIYUN_DASHSCOPE_TTS_MODEL?.trim() || "qwen3-tts-instruct-flash",
      designRequested: profile.provider_status === "missing",
      characterCount: profile.preview_text.length,
      status: "failed",
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "failed",
      body: {
        error: "voice_preview_failed",
        reason_code: error instanceof Error ? error.message : "unknown",
      },
    };
  }
}
