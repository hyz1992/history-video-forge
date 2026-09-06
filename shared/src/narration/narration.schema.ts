import { z } from "zod";
import { SubtitleStyle } from "../assets/asset-manifest.schema.js";
import { SubtitleStyleOverrideSet } from "../creative/creative-preset.schema.js";
import { NarrationInteger, NarrationSha256 } from "./narration-timing.schema.js";

const id = z.string().min(1).refine(s => s.trim() === s);
const date = z.string().datetime({ offset: true });
export const NarrationTimingMode = z.enum(["legacy_estimated", "narration_first_v1"]);
export type NarrationTimingMode = z.infer<typeof NarrationTimingMode>;
/** 只开放已实测的 neutral/rate=1；其余参数需新的资格记录。 */
export const NarrationCreativeSettings = z.object({ tone: z.literal("neutral"), rate: z.literal(1) }).strict();
export type NarrationCreativeSettings = z.infer<typeof NarrationCreativeSettings>;
export const DEFAULT_NARRATION_CREATIVE_SETTINGS: NarrationCreativeSettings = { tone: "neutral", rate: 1 };
export const QualifiedNarrationSettings = z.object({
  model: z.literal("qwen-audio-3.0-tts-plus"), voice: z.literal("qwen-audio-3.0-tts-plus-longyimuling"),
  region: z.literal("cn-beijing"), protocol: z.literal("dashscope_ws"),
  parametersVersion: z.literal("neutral-pcm24k-v1"),
  ...NarrationCreativeSettings.shape, pitch: z.literal(1), volume: z.literal(50),
  sampleRate: z.literal(24000), format: z.literal("pcm"), textType: z.literal("PlainText"),
  wordTimestampEnabled: z.literal(true), enableSsml: z.literal(false), seed: z.literal(0),
  inputMode: z.literal("natural_paragraphs_single_task"),
}).strict();
export type QualifiedNarrationSettings = z.infer<typeof QualifiedNarrationSettings>;

export const NarrationDurationBand = z.object({ minMs: NarrationInteger.positive(), maxMs: NarrationInteger.positive() })
  .strict().refine(b => b.maxMs >= b.minMs, { message: "narration_duration_band_invalid" });
export type NarrationDurationBand = z.infer<typeof NarrationDurationBand>;

/** URI 是项目根下的相对存储引用，不能携带路径穿越、编码别名或 URL。 */
export const NarrationFileReference = z.object({
  uri: z.string().regex(/^narration-runs\/[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/),
  sha256: NarrationSha256,
}).strict();
export type NarrationFileReference = z.infer<typeof NarrationFileReference>;

export const NarrationSubtitleSettingsSnapshot = z.object({
  presetId: id.nullable(), presetVersion: z.string().regex(/^v[1-9]\d*$/).nullable(),
  resolvedStyle: SubtitleStyle, overrides: SubtitleStyleOverrideSet,
  lineBreak: z.object({ strategy: z.literal("punctuation_and_length"), maxCharactersPerLine: NarrationInteger.min(1).max(80), version: id }).strict(),
  resolverVersion: id,
}).strict().refine(s => (s.presetId === null) === (s.presetVersion === null),
  { message: "narration_subtitle_preset_version_required" });
export type NarrationSubtitleSettingsSnapshot = z.infer<typeof NarrationSubtitleSettingsSnapshot>;

export const NarrationSubtitleRevision = z.object({
  id, projectId: id, narrationRecordId: id, audioHash: NarrationSha256, timingHash: NarrationSha256,
  subtitleSettingsSnapshotJson: NarrationSubtitleSettingsSnapshot, subtitleSettingsHash: NarrationSha256,
  builderVersion: id, srt: NarrationFileReference, vtt: NarrationFileReference, createdAt: date,
}).strict();
export type NarrationSubtitleRevision = z.infer<typeof NarrationSubtitleRevision>;

export const NarrationValidationReport = z.object({
  status: z.literal("pass"), validatorVersion: id, checkedAt: date,
  nativeTextCoverageComplete: z.literal(true), nativeTimingValid: z.literal(true),
  audioProbeValid: z.literal(true), issues: z.array(id).length(0),
}).strict();
export const NarrationOutput = z.object({
  audio: NarrationFileReference.extend({ sampleRate: z.literal(24000), channels: z.literal(1), bitDepth: z.literal(16), sampleCount: NarrationInteger.positive() }),
  durationMs: NarrationInteger.positive(), nativeEvents: NarrationFileReference,
  timingMap: NarrationFileReference, initialSubtitleRevisionId: id, validationReport: NarrationValidationReport,
}).strict().refine(o => Number.isSafeInteger(o.durationMs) && Number.isSafeInteger(o.audio.sampleCount) && BigInt(o.durationMs) === (BigInt(o.audio.sampleCount) * 1000n + BigInt(o.audio.sampleRate / 2)) / BigInt(o.audio.sampleRate),
  { message: "narration_duration_probe_mismatch" });
export type NarrationOutput = z.infer<typeof NarrationOutput>;

export const NarrationRecord = z.object({
  schemaVersion: z.literal("narration_record_v1"), id, projectId: id, scriptRecordId: id, generationRunId: id,
  createdAt: date, updatedAt: date, sourceTextSha256: NarrationSha256, spokenTextSha256: NarrationSha256.nullable(),
  settingsSha256: NarrationSha256, sourceProjectTtsSettingsSha256: NarrationSha256,
  textMappingVersion: z.literal("narration-native-spans/v1"), configurationSnapshotId: id,
  settings: QualifiedNarrationSettings, timingSource: z.literal("provider_native"),
  providerTaskId: id.nullable(), providerRequestId: id.nullable(),
  status: z.enum(["generating", "ready", "confirmed", "failed", "cancelled", "stale", "unknown"]),
  errorCode: id.nullable(), confirmedAt: date.nullable(), confirmedBy: id.nullable(),
  acceptedDurationBandSnapshot: NarrationDurationBand.nullable(), output: NarrationOutput.nullable(),
}).strict().superRefine((r, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if ((r.status === "ready" || r.status === "confirmed") && (!r.output || !r.spokenTextSha256 || !r.providerTaskId)) fail("narration_complete_bundle_required");
  if (r.status === "generating" && r.output) fail("narration_partial_output_forbidden");
  if ((r.confirmedAt === null) !== (r.confirmedBy === null)) fail("narration_confirmation_identity_invalid");
  if (r.status === "confirmed" && (!r.confirmedAt || !r.acceptedDurationBandSnapshot)) fail("narration_confirmation_required");
  if ((r.status === "failed" || r.status === "unknown") && !r.errorCode) fail("narration_error_code_required");
  if (Date.parse(r.updatedAt) < Date.parse(r.createdAt)) fail("narration_record_dates_invalid");
});
export type NarrationRecord = z.infer<typeof NarrationRecord>;

export const GenerateNarrationRequest = z.object({
  source_script_record_id: id, expected_configuration_revision: NarrationInteger,
  idempotency_key: z.string().min(1).max(200).refine(s => s.trim() === s), settings_override: NarrationCreativeSettings.partial().optional(),
}).strict();
export type GenerateNarrationRequest = z.infer<typeof GenerateNarrationRequest>;
export const ConfirmNarrationRequest = z.object({
  source_text_sha256: NarrationSha256, settings_sha256: NarrationSha256,
  expected_active_narration_record_id: id.nullable(),
  target_duration_band_snapshot: NarrationDurationBand,
  accept_duration_outside_band: z.boolean(),
}).strict();
export type ConfirmNarrationRequest = z.infer<typeof ConfirmNarrationRequest>;
export const DeriveNarrationSubtitlesRequest = z.object({
  expected_narration_record_id: id, expected_audio_hash: NarrationSha256,
  subtitle_settings_hash: NarrationSha256,
}).strict();
export type DeriveNarrationSubtitlesRequest = z.infer<typeof DeriveNarrationSubtitlesRequest>;
