import { describe, expect, it } from 'vitest';
import * as shared from '../../shared/src/index.js';
import { DEFAULT_SUBTITLE_STYLE } from '../../shared/src/assets/asset-manifest.schema.js';
import { GenerationOperationSchema } from '../../shared/src/generation/generation-configuration-resolver.js';
import { OPERATION_TOKEN_ESTIMATES } from '../../backend/src/modules/generation-cost/generation-cost.service.js';
const api = shared;
const h = 'a'.repeat(64);
const settings = () => ({
  model: 'qwen-audio-3.0-tts-plus',
  voice: 'qwen-audio-3.0-tts-plus-longyimuling',
  region: 'cn-beijing',
  protocol: 'dashscope_ws',
  parametersVersion: 'neutral-pcm24k-v1',
  tone: 'neutral',
  rate: 1,
  pitch: 1,
  volume: 50,
  sampleRate: 24000,
  format: 'pcm',
  textType: 'PlainText',
  wordTimestampEnabled: true,
  enableSsml: false,
  seed: 0,
  inputMode: 'natural_paragraphs_single_task'
});
const subtitle = () => ({
  presetId: null,
  presetVersion: null,
  resolvedStyle: { ...DEFAULT_SUBTITLE_STYLE },
  overrides: {},
  lineBreak: {
    strategy: 'punctuation_and_length',
    maxCharactersPerLine: 18,
    version: 'narration-line-break/v1'
  },
  resolverVersion: 'subtitle-style/v1'
});
const token = (i: number) => ({
  id: 'w' + i,
  sourceStart: i,
  sourceEnd: i + 1,
  spokenText: '汉',
  startMs: i * 250,
  endMs: (i + 1) * 250,
  providerSentenceIndex: 0,
  providerIndexRange: [i, i + 1]
});
const timing = () => ({
  schemaVersion: 'narration_timing_map_v1',
  sourceText: '汉'.repeat(18),
  spokenText: '汉'.repeat(18),
  textMappingVersion: 'narration-native-spans/v1',
  audioHash: h,
  durationMs: 4500,
  tokens: Array.from({ length: 18 }, (_, i) => token(i)),
  sourceSpans: Array.from({ length: 18 }, (_, i) => ({
    id: 's' + i,
    sourceStart: i,
    sourceEnd: i + 1,
    startMs: i * 250,
    endMs: (i + 1) * 250,
    tokenIds: ['w' + i],
    mergeReason: 'positive_native_token'
  })),
  boundaries: Array.from({ length: 19 }, (_, i) => ({
    id: 'b' + i,
    sourceOffset: i,
    visualTimeMs: i * 250,
    leftTokenId: i === 0 ? null : 'w' + (i - 1),
    rightTokenId: i === 18 ? null : 'w' + i,
    ruleVersion: 'narration-boundaries/v1',
    rawCandidateSourceOffsets: [i],
    legalCandidateSourceOffsets: [i],
    selectionReason: i === 0 || i === 18 ? 'edge' : 'maximum_legal_source_offset'
  }))
});
const parses = (name: keyof typeof shared, value: unknown) => {
  const schema = shared[name] as {
    safeParse(input: unknown): {
      success: boolean;
    };
  };
  return schema.safeParse(value).success;
};
describe('口播共享合同', () => {
  it('整篇原生时间图保留全部可选边界，包括1500ms', () => {
    expect(parses('NarrationTimingMapV1', timing())).toBe(true);
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])('拒绝非法毫秒 %s', (n) => {
    const m = timing();
    m.tokens[0].startMs = n;
    expect(parses('NarrationTimingMapV1', m)).toBe(false);
  });
  it('拒绝倒序、越界、缺hash、缺失边界和多余字段', () => {
    for (const change of [(m: any) => m.tokens[0].endMs = -1, (m: any) => m.tokens[17].endMs = 4501, (m: any) => delete m.audioHash, (m: any) => m.boundaries.splice(6, 1), (m: any) => m.extra = true]) {
      const m = timing();
      change(m);
      expect(parses('NarrationTimingMapV1', m)).toBe(false);
    }
  });
  it('只接受冻结模型、音色、地域及基准参数组合', () => {
    expect(parses('QualifiedNarrationSettings', settings())).toBe(true);
    for (const [key, value] of Object.entries({
      model: 'cosyvoice-v3-flash',
      voice: 'longanyang',
      tone: 'sad',
      rate: 1.1,
      pitch: 2,
      region: 'ap-southeast-1',
      protocol: 'http',
      seed: 1,
      volume: 51
    })) {
      expect(parses('QualifiedNarrationSettings', { ...settings(), [key]: value })).toBe(false);
    }
  });
  it('原生零时长必须有同句共享端点归并证据', () => {
    const m = timing();
    m.tokens[1].startMs = 250;
    m.tokens[1].endMs = 250;
    m.sourceSpans.splice(0, 2, {
      id: 's0',
      sourceStart: 0,
      sourceEnd: 2,
      startMs: 0,
      endMs: 250,
      tokenIds: ['w0', 'w1'],
      mergeReason: 'zero_duration_run_attached_to_previous_shared_end'
    });
    m.boundaries.splice(1, 1);
    expect(parses('NarrationTimingMapV1', m)).toBe(true);
    m.tokens[1].providerSentenceIndex = 1;
    expect(parses('NarrationTimingMapV1', m)).toBe(false);
  });
  it('字幕冻结完整样式且无动态缺省', () => {
    expect(parses('NarrationSubtitleSettingsSnapshot', subtitle())).toBe(true);
    const s: any = subtitle();
    delete s.resolvedStyle.safe_area_top_px;
    expect(parses('NarrationSubtitleSettingsSnapshot', s)).toBe(false);
  });
  it('旧配置无新参数仍保持原值，新字段限定neutral', () => {
    const old = shared.GenerationConfigurationV1.parse(shared.DEFAULT_GENERATION_CONFIGURATION);
    expect(old).toEqual(shared.DEFAULT_GENERATION_CONFIGURATION);
    expect(parses('GenerationConfigurationV1', { ...old, creative: { ...old.creative, narration: { tone: 'neutral', rate: 1 } } })).toBe(true);
    expect(parses('GenerationConfigurationV1', { ...old, creative: { ...old.creative, narration: { tone: 'sad', rate: 1 } } })).toBe(false);
  });
  it('口播operation复用TTS且纯媒体费用零token', () => {
    expect(GenerationOperationSchema.safeParse('script.narration.generate').success).toBe(true);
    expect(api.GENERATION_OPERATION_CAPABILITY?.['script.narration.generate']).toBe('tts.synthesize');
    expect(OPERATION_TOKEN_ESTIMATES['script.narration.generate' as keyof typeof OPERATION_TOKEN_ESTIMATES]).toEqual({ estimated_input_tokens: 0, estimated_output_tokens: 0 });
  });
  it('字幕配置hash为完整SHA256且独立于音频配置', async () => {
    expect(typeof api.hashNarrationSettings).toBe('function');
    const a = await api.hashNarrationSettings(settings());
    const b = await api.hashNarrationSubtitleSettings(subtitle());
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(await api.hashNarrationSettings({ ...settings() }));
    expect(b).not.toBe(await api.hashNarrationSubtitleSettings({ ...subtitle(), resolverVersion: 'subtitle-style/v2' }));
    expect(a).toBe(await api.hashNarrationSettings(settings()));
  });
  it('独立版本联合拒绝v2缺少narration且旧类型不变', () => {
    expect(typeof api.VersionedStoryboardPlan).toBe('object');
    expect(typeof api.VersionedAssetPlan).toBe('object');
    expect(typeof api.VersionedAssetManifest).toBe('object');
    for (const [name, version] of [['VersionedStoryboardPlan', 'storyboard_v2'], ['VersionedAssetPlan', 'asset_plan_v2'], ['VersionedAssetManifest', 'asset_manifest_v2']])
      expect(parses(name, { plan_version: version })).toBe(false);
  });
});
const state = () => ({
  sourceTextSha256: h,
  pronunciationRulesVersion: 'plain/v1',
  ttsSettingsSha256: h,
  targetDurationBand: { minMs: 1000, maxMs: 5000 },
  subtitleSettingsSha256: h,
  visualSettingsSha256: h
});
describe('口播配置失效序列', () => {
  it('字幕→语音→目标区间组合只失效各自依赖', () => {
    expect(typeof api.resolveNarrationInvalidation).toBe('function');
    const a = state();
    const b = { ...a, subtitleSettingsSha256: 'b'.repeat(64) };
    const c = { ...b, ttsSettingsSha256: 'c'.repeat(64) };
    const d = { ...c, targetDurationBand: { minMs: 2000, maxMs: 6000 } };
    expect(api.resolveNarrationInvalidation({
      before: a,
      after: b,
      scope: 'project_saved'
    })).toEqual({
      regenerateNarration: false,
      reconfirmNarration: false,
      rebuildSubtitles: true,
      invalidatedStages: ['compose', 'render', 'publish']
    });
    expect(api.resolveNarrationInvalidation({
      before: b,
      after: c,
      scope: 'project_saved'
    }).invalidatedStages).toEqual(['storyboard', 'asset_plan', 'assets', 'compose', 'render', 'publish']);
    expect(api.resolveNarrationInvalidation({
      before: c,
      after: d,
      scope: 'project_saved'
    })).toEqual({
      regenerateNarration: false,
      reconfirmNarration: true,
      rebuildSubtitles: false,
      invalidatedStages: []
    });
  });
  it('升级缺省与显式基准参数同hash，字段重排无漂移', async () => {
    expect(typeof api.hashProjectNarrationTtsSettings).toBe('function');
    const a = shared.DEFAULT_GENERATION_CONFIGURATION;
    const b = { ...a, creative: { ...a.creative, narration: { tone: 'neutral', rate: 1 } } };
    expect(await api.hashProjectNarrationTtsSettings(a)).toBe(await api.hashProjectNarrationTtsSettings(b));
    expect(await api.hashNarrationSubtitleSettings(subtitle())).toBe(await api.hashNarrationSubtitleSettings(Object.fromEntries(Object.entries(subtitle()).reverse())));
  });
  it('恢复序列保留变更影响，草稿与用户默认不追改项目', () => {
    expect(typeof api.resolveNarrationInvalidation).toBe('function');
    const a = state();
    const b = JSON.parse(JSON.stringify({
      ...a,
      sourceTextSha256: 'd'.repeat(64),
      visualSettingsSha256: 'e'.repeat(64)
    }));
    expect(api.resolveNarrationInvalidation({
      before: a,
      after: b,
      scope: 'project_saved'
    }).regenerateNarration).toBe(true);
    for (const scope of ['draft', 'user_default'])
      expect(api.resolveNarrationInvalidation({
        before: a,
        after: b,
        scope
      }).invalidatedStages).toEqual([]);
    expect(() => api.resolveNarrationInvalidation({
      before: a,
      after: { ...b, targetDurationBand: { minMs: NaN, maxMs: 5 } },
      scope: 'project_saved'
    })).toThrow();
  });
  it('视觉修改并存字幕修改仍复用音频，不遗漏字幕重建', () => {
    expect(typeof api.resolveNarrationInvalidation).toBe('function');
    const a = state();
    const b = {
      ...a,
      visualSettingsSha256: 'b'.repeat(64),
      subtitleSettingsSha256: 'c'.repeat(64)
    };
    const r = api.resolveNarrationInvalidation({
      before: a,
      after: b,
      scope: 'project_saved'
    });
    expect(r.regenerateNarration).toBe(false);
    expect(r.rebuildSubtitles).toBe(true);
    expect(r.invalidatedStages).toEqual(['asset_plan', 'assets', 'compose', 'render', 'publish']);
  });
});
const record = () => ({
  schemaVersion: 'narration_record_v1',
  id: 'n1',
  projectId: 'p1',
  scriptRecordId: 'script1',
  generationRunId: 'run1',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  sourceTextSha256: h,
  spokenTextSha256: h,
  settingsSha256: h,
  sourceProjectTtsSettingsSha256: h,
  textMappingVersion: 'narration-native-spans/v1',
  configurationSnapshotId: 'snap1',
  settings: settings(),
  timingSource: 'provider_native',
  providerTaskId: null,
  providerRequestId: null,
  status: 'generating',
  errorCode: null,
  confirmedAt: null,
  confirmedBy: null,
  acceptedDurationBandSnapshot: null,
  output: null
});
it('记录状态与输出原子合同、确认CAS和字幕派生请求严格校验', () => {
  expect(parses('NarrationRecord', record())).toBe(true);
  expect(parses('NarrationRecord', { ...record(), status: 'ready' })).toBe(false);
  expect(parses('ConfirmNarrationRequest', {
    source_text_sha256: h,
    settings_sha256: h,
    expected_active_narration_record_id: null,
    target_duration_band_snapshot: { minMs: 1000, maxMs: 5000 },
    accept_duration_outside_band: false
  })).toBe(true);
  expect(parses('ConfirmNarrationRequest', {
    source_text_sha256: h,
    settings_sha256: h,
    accept_duration_outside_band: false
  })).toBe(false);
  expect(parses('GenerateNarrationRequest', {
    source_script_record_id: 's1',
    expected_configuration_revision: 0,
    idempotency_key: 'key1'
  })).toBe(true);
  expect(parses('GenerateNarrationRequest', {
    source_script_record_id: 's1',
    expected_configuration_revision: 0,
    idempotency_key: 'key1',
    settings_override: { tone: 'angry', rate: 1 }
  })).toBe(false);
});
const legacyStoryboard = () => ({
  plan_version: 'storyboard_v1',
  source_script_record_id: 's1',
  source_topic_package_id: 't1',
  estimated_total_duration_sec: 4.5,
  global_visual_notes: [],
  segments: [{
    segment_id: 'seg1',
    order: 0,
    script_excerpt: '汉'.repeat(18),
    start_hint_sec: 0,
    end_hint_sec: 4.5,
    narrative_role: 'opening',
    visual_intent: '宫门',
    scene_description: '宫门',
    visual_elements: ['门'],
    framing_hint: 'wide',
    content_type: 'live_action',
    motion_hint: 'static',
    editing_hint: 'single',
    on_screen_text: [],
    linked_beats: [],
    linked_quotes: [],
    risk_notes: [],
    api_video_suitability: 'remotion_only'
  }]
});
const ref = () => ({
  narration_record_id: 'n1',
  audio_hash: h,
  timing_map_hash: h,
  duration_ms: 4500
});
const range = () => ({
  start_boundary_id: 'b0',
  end_boundary_id: 'b18',
  source_start: 0,
  source_end: 18,
  visual_start_ms: 0,
  visual_end_ms: 4500
});
it('v1继续读取，v2完整正例且只缺来源时拒绝', () => {
  const old = legacyStoryboard();
  expect(parses('VersionedStoryboardPlan', old)).toBe(true);
  const next: any = {
    ...old,
    plan_version: 'storyboard_v2',
    narration_reference: ref(),
    segments: old.segments.map(s => ({ ...s, ...range() }))
  };
  expect(parses('VersionedStoryboardPlan', next)).toBe(true);
  delete next.narration_reference;
  expect(parses('VersionedStoryboardPlan', next)).toBe(false);
});
it('生成中不伪造spoken hash，ready必须有真实spoken hash', () => {
  expect(parses('NarrationRecord', { ...record(), spokenTextSha256: null })).toBe(true);
  expect(parses('NarrationRecord', {
    ...record(),
    status: 'ready',
    spokenTextSha256: null
  })).toBe(false);
});
it('拒绝局部重叠来源和同source跨片段拆分', () => {
  for (const ranges of [[[0, 2], [1, 3]], [[0, 2], [0, 2]]]) {
    const m: any = timing();
    m.tokens[0].sourceEnd = ranges[0][1];
    m.tokens[1].sourceStart = ranges[1][0];
    m.tokens[1].sourceEnd = ranges[1][1];
    m.sourceSpans[0].sourceEnd = ranges[0][1];
    m.sourceSpans[1].sourceStart = ranges[1][0];
    m.sourceSpans[1].sourceEnd = ranges[1][1];
    m.boundaries.splice(1, 1);
    if (ranges[1][1] === 3) {
      m.tokens.splice(2, 1);
      m.sourceSpans.splice(2, 1);
      m.boundaries.splice(1, 1);
      m.spokenText = m.tokens.map((t: any) => t.spokenText).join('');
    }
    expect(parses('NarrationTimingMapV1', m)).toBe(false);
  }
});
it('字幕cue必须位于同一音频时间域且显示不重叠', () => {
  const cue = {
    id: 'c1',
    text: '汉',
    sourceStart: 0,
    sourceEnd: 1,
    speechStartMs: 0,
    speechEndMs: 250,
    displayStartMs: 0,
    displayEndMs: 500
  };
  const value = {
    schemaVersion: 'narration_subtitle_timeline_v1',
    audioHash: h,
    timingHash: h,
    durationMs: 1000,
    cues: [cue]
  };
  expect(parses('NarrationSubtitleTimelineV1', value)).toBe(true);
  expect(parses('NarrationSubtitleTimelineV1', { ...value, durationMs: 100 })).toBe(false);
  expect(parses('NarrationSubtitleTimelineV1', {
    ...value, cues: [cue, {
      ...cue,
      id: 'c2',
      sourceStart: 1,
      sourceEnd: 2,
      speechStartMs: 300,
      speechEndMs: 500,
      displayStartMs: 300,
      displayEndMs: 600
    }]
  })).toBe(false);
});
const legacyAssetPlan = () => ({
  plan_version: 'asset_plan_v1',
  source_storyboard_record_id: 'sb1',
  source_script_record_id: 's1',
  source_topic_package_id: 't1',
  art_bible: {
    era_style: '汉',
    visual_tone: '宫廷',
    characters: [],
    locations: [],
    props: [],
    global_prompt_prefix: '汉',
    global_negative_prompts: [],
    consistency_notes: []
  },
  global_audio_strategy: { bgm_strategy: 'existing' },
  tts_plan: {
    voice_profile_id: 'v1',
    estimated_total_duration_sec: 4.5,
    chunking_strategy: 'sentence_boundary',
    chunks: []
  },
  tasks: [{
    task_id: 'task1',
    order: 0,
    task_type: 'image_still',
    source_segment_id: 'seg1',
    source_excerpt: '汉'.repeat(18),
    production_intent: '宫门',
    recommended_mode: 'auto',
    provider_hint: null,
    prompt_draft: '宫门',
    parameters: {},
    risk_notes: [],
    cost_tier: 'low',
    initial_status: 'planned'
  }],
  dependencies: [],
  cost_summary: {
    total_tasks: 1,
    by_type: { image_still: 1 },
    by_cost_tier: { low: 1 },
    estimated_provider_calls: 1,
    notes: []
  },
  global_production_notes: []
});
it('asset v1/v2正例、BGM原策略保留而音色重选/TTS任务拒绝', () => {
  const old: any = legacyAssetPlan();
  expect(parses('VersionedAssetPlan', old)).toBe(true);
  const { tts_plan, ...common } = old;
  const next: any = {
    ...common,
    plan_version: 'asset_plan_v2',
    narration_reference: ref(),
    narration_intervals: [{ segment_id: 'seg1', range: range() }]
  };
  expect(parses('VersionedAssetPlan', next)).toBe(true);
  expect(parses('VersionedAssetPlan', { ...next, global_audio_strategy: { voice_intent: {} } })).toBe(false);
  expect(parses('VersionedAssetPlan', { ...next, tasks: next.tasks.map((t: any) => ({ ...t, task_type: 'tts_audio' })) })).toBe(false);
  delete next.narration_reference;
  expect(parses('VersionedAssetPlan', next)).toBe(false);
});
const output = () => ({
  audio: {
    uri: 'narration-runs/run1/audio.wav',
    sha256: h,
    sampleRate: 24000,
    channels: 1,
    bitDepth: 16,
    sampleCount: 24000
  },
  durationMs: 1000,
  nativeEvents: { uri: 'narration-runs/run1/native.json', sha256: h },
  timingMap: { uri: 'narration-runs/run1/timing.json', sha256: h },
  initialSubtitleRevisionId: 'sub1',
  validationReport: {
    status: 'pass',
    validatorVersion: 'v1',
    checkedAt: '2026-09-06T00:00:00.000Z',
    nativeTextCoverageComplete: true,
    nativeTimingValid: true,
    audioProbeValid: true,
    issues: []
  }
});
it('完整输出正例且不可信sampleCount不会逃逸成运行时异常', () => {
  expect(parses('NarrationOutput', output())).toBe(true);
  for (const sampleCount of [1.5, Number.MAX_SAFE_INTEGER + 1, -1])
    expect(parses('NarrationOutput', { ...output(), audio: { ...output().audio, sampleCount } })).toBe(false);
});
const legacyManifest = () => ({
  manifest_version: 'asset_manifest_v1',
  source_asset_plan_id: 'ap1',
  source_storyboard_record_id: 'sb1',
  source_script_record_id: 's1',
  execution_options: {
    execution_mode: 'auto_available',
    voice_profile_id: 'v1',
    enabled_provider_types: ['image'],
    allow_manual_placeholders: false
  },
  executions: [],
  artifacts: [],
  audio_summary: {
    voice_profile_id: 'v1',
    tts_total_duration_sec: 4.5,
    tts_chunk_artifact_ids: [],
    tts_chunk_routes: [],
    tts_merged_artifact_id: null,
    subtitle_artifact_id: null,
    bgm_placements: [],
    sfx_artifact_ids: []
  },
  segment_routes: [{
    segment_id: 'seg1',
    tts_artifact_id: null,
    subtitle_artifact_id: null,
    primary_visual_artifact_id: null,
    visual_route_type: 'missing',
    motion_artifact_id: null,
    fallback_visual_artifact_id: null,
    sfx_artifact_ids: [],
    bgm_placement_ids: [],
    readiness: 'blocked',
    notes: []
  }],
  readiness: 'blocked',
  notes: []
});
it('manifest独立v1/v2读取且缺少narration引用拒绝', () => {
  const old = legacyManifest();
  expect(parses('VersionedAssetManifest', old)).toBe(true);
  const next: any = manifestWithInterval(0, 4500);
  expect(parses('VersionedAssetManifest', next)).toBe(true);
  delete next.narration_reference;
  expect(parses('VersionedAssetManifest', next)).toBe(false);
});
it('生成请求revision及确认来源字段全部必填', () => {
  const generate: any = {
    source_script_record_id: 's1',
    expected_configuration_revision: 0,
    idempotency_key: 'k1'
  };
  for (const field of Object.keys(generate)) {
    const input = { ...generate };
    delete input[field];
    expect(parses('GenerateNarrationRequest', input)).toBe(false);
  }
  const confirm: any = {
    source_text_sha256: h,
    settings_sha256: h,
    expected_active_narration_record_id: null,
    target_duration_band_snapshot: { minMs: 1000, maxMs: 5000 },
    accept_duration_outside_band: false
  };
  for (const field of Object.keys(confirm)) {
    const input = { ...confirm };
    delete input[field];
    expect(parses('ConfirmNarrationRequest', input)).toBe(false);
  }
});
it('字幕派生绑定现有口播和音频hash', () => {
  const value = {
    expected_narration_record_id: 'n1',
    expected_audio_hash: h,
    subtitle_settings_hash: h
  };
  expect(parses('DeriveNarrationSubtitlesRequest', value)).toBe(true);
  expect(parses('DeriveNarrationSubtitlesRequest', { ...value, expected_audio_hash: 'bad' })).toBe(false);
});
it('零时长原生成员provider序号不连续或正文缺口均拒绝', () => {
  const m: any = timing();
  m.tokens[1].startMs = 250;
  m.tokens[1].endMs = 250;
  m.sourceSpans.splice(0, 2, {
    id: 's0',
    sourceStart: 0,
    sourceEnd: 2,
    startMs: 0,
    endMs: 250,
    tokenIds: ['w0', 'w1'],
    mergeReason: 'zero_duration_run_attached_to_previous_shared_end'
  });
  m.boundaries.splice(1, 1);
  expect(parses('NarrationTimingMapV1', m)).toBe(true);
  for (const mutate of [(x: any) => x.tokens[1].providerIndexRange = [2, 3], (x: any) => {
    x.sourceText = '汉缺' + x.sourceText.slice(1);
    x.tokens[1].sourceStart = 2;
    x.tokens[1].sourceEnd = 3;
  }]) {
    const bad = structuredClone(m);
    mutate(bad);
    expect(parses('NarrationTimingMapV1', bad)).toBe(false);
  }
});
it('resolver真实合并口播override到快照且legacy auto排序语义不变', () => {
  const project = shared.DEFAULT_GENERATION_CONFIGURATION;
  const catalog = shared.CAPABILITY_SLOTS.map((slot) => ({
    provider_model_id: slot,
    capability: slot,
    provider_key: 'fake',
    model_id: 'old-default',
    status: 'active',
    is_default: true
  }));
  const input = {
    projectConfiguration: project,
    projectConfigurationRevision: 1,
    sourceUserPreferenceRevision: null,
    systemConstraints: { apiVideoProviderEnabled: false },
    providerModelCatalog: catalog,
    operation: 'script.narration.generate',
    runOverrides: { creative: { narration: { tone: 'neutral', rate: 1 } } }
  };
  const resolved = shared.resolveGenerationConfiguration(input);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok)
    throw Error(resolved.error.message);
  expect(resolved.value.effective.creative.narration).toEqual({ tone: 'neutral', rate: 1 });
  expect(project.creative).not.toHaveProperty('narration');
  expect(resolved.value.resolved_capabilities['tts.synthesize'].model_id).toBe('old-default');
  const reordered = shared.resolveGenerationConfiguration({ ...input, providerModelCatalog: [...catalog].reverse() });
  expect(reordered).toEqual(resolved);
  const duplicate = shared.resolveGenerationConfiguration({ ...input, providerModelCatalog: [...catalog, catalog[0]] });
  expect(duplicate.ok).toBe(false);
  const recovered = shared.resolveGenerationConfiguration(JSON.parse(JSON.stringify(input)));
  expect(recovered).toEqual(resolved);
});
it('项目语音投影不吸收画风/字幕/视频改变但模型音色改变失效', async () => {
  const old = shared.DEFAULT_GENERATION_CONFIGURATION;
  const oldHash = await shared.hashProjectNarrationTtsSettings(old);
  const changed = {
    ...old,
    video: { strategy: 'all_remotion', api_quality: 'high_1080p' },
    creative: {
      ...old.creative,
      art_style_preset_id: 'art1',
      subtitle_style_preset_id: 'sub1',
      subtitle_style_overrides: { font_size_px: 60 }
    }
  };
  expect(await shared.hashProjectNarrationTtsSettings(changed)).toBe(oldHash);
  expect(await shared.hashProjectNarrationTtsSettings({ ...old, creative: { ...old.creative, voice_profile_id: 'voice2' } })).not.toBe(oldHash);
  expect(await shared.hashProjectNarrationTtsSettings({ ...old, capabilities: { ...old.capabilities, 'tts.synthesize': { mode: 'fixed', provider_model_id: 'qwen' } } })).not.toBe(oldHash);
});
// R1 / F1：同一组原始 token 的归并归属不得由传入片段改变。
function zeroChoiceMap(side: 'previous' | 'next', previousSameSentence = true) {
  const tokens = [
    { ...token(0), spokenText: '甲' },
    {
      ...token(1),
      spokenText: '乙',
      startMs: 250,
      endMs: 250,
      providerSentenceIndex: previousSameSentence ? 0 : 1
    },
    {
      ...token(2),
      spokenText: '丙',
      startMs: 250,
      endMs: 500,
      providerSentenceIndex: previousSameSentence ? 0 : 1
    },
  ];
  const previous = side === 'previous';
  const offset = previous ? 2 : 1;
  return {
    ...timing(),
    sourceText: '甲乙丙',
    spokenText: '甲乙丙',
    durationMs: 500,
    tokens,
    sourceSpans: previous ? [
      {
        id: 's0',
        sourceStart: 0,
        sourceEnd: 2,
        startMs: 0,
        endMs: 250,
        tokenIds: ['w0', 'w1'],
        mergeReason: 'zero_duration_run_attached_to_previous_shared_end'
      },
      {
        id: 's2',
        sourceStart: 2,
        sourceEnd: 3,
        startMs: 250,
        endMs: 500,
        tokenIds: ['w2'],
        mergeReason: 'positive_native_token'
      },
    ] : [
      {
        id: 's0',
        sourceStart: 0,
        sourceEnd: 1,
        startMs: 0,
        endMs: 250,
        tokenIds: ['w0'],
        mergeReason: 'positive_native_token'
      },
      {
        id: 's1',
        sourceStart: 1,
        sourceEnd: 3,
        startMs: 250,
        endMs: 500,
        tokenIds: ['w1', 'w2'],
        mergeReason: 'zero_duration_run_attached_to_next_shared_start'
      },
    ],
    boundaries: [
      { ...timing().boundaries[0] },
      {
        ...timing().boundaries[offset],
        visualTimeMs: 250,
        rawCandidateSourceOffsets: [1, 2],
        legalCandidateSourceOffsets: [offset]
      },
      {
        ...timing().boundaries[18],
        id: 'b3',
        sourceOffset: 3,
        visualTimeMs: 500,
        leftTokenId: 'w2',
        rawCandidateSourceOffsets: [3],
        legalCandidateSourceOffsets: [3]
      },
    ],
  };
}
describe('R1 F1 原始零点归并优先级', () => {
  it('双侧均合法时拒绝后归并，合法前归并保留offset2', () => {
    expect(parses('NarrationTimingMapV1', zeroChoiceMap('next'))).toBe(false);
    const map = zeroChoiceMap('previous');
    expect(parses('NarrationTimingMapV1', map)).toBe(true);
    expect(map.boundaries[1].sourceOffset).toBe(2);
  });
  it('前侧跨句不合法而后侧合法时接受后归并', () => {
    expect(parses('NarrationTimingMapV1', zeroChoiceMap('next', false))).toBe(true);
    expect(parses('NarrationTimingMapV1', zeroChoiceMap('previous', false))).toBe(false);
  });
});
describe('R1 F2 全任务provider序号连续', () => {
  it.each([[0, 1], [999, 1000]])('跨句拒绝回退或跳号%s', (start, end) => {
    const map = timing();
    map.tokens[17].providerSentenceIndex = 1;
    map.tokens[17].providerIndexRange = [start, end];
    expect(parses('NarrationTimingMapV1', map)).toBe(false);
  });
  it('句序号前进时允许连续的任务累计序号', () => {
    const map = timing();
    map.tokens[17].providerSentenceIndex = 1;
    expect(parses('NarrationTimingMapV1', map)).toBe(true);
  });
});
function planWithInterval(startMs: number, endMs: number) {
  const { tts_plan, ...common } = legacyAssetPlan();
  return {
    ...common,
    plan_version: 'asset_plan_v2',
    narration_reference: ref(),
    narration_intervals: [{
      segment_id: 'seg1', range: {
        ...range(),
        visual_start_ms: startMs,
        visual_end_ms: endMs
      }
    }],
  };
}
function manifestWithInterval(startMs: number, endMs: number) {
  const old = legacyManifest();
  const provenance = { narration_record_id: ref().narration_record_id, audio_hash: h, timing_map_hash: h, timing_source: 'provider_timestamp' };
  const route = { ...old.segment_routes[0], tts_artifact_id: 'audio', subtitle_artifact_id: 'subtitle' };
  return {
    ...old, manifest_version: 'asset_manifest_v2', narration_reference: ref(), subtitle_revision_id: 'sub1', subtitle_settings_hash: h,
    execution_options: { ...old.execution_options, subtitle_style: DEFAULT_SUBTITLE_STYLE },
    artifacts: [
      { artifact_id: 'audio', artifact_type: 'tts_merged_audio', origin: 'local', file_uri: '/audio.wav', created_at: '2026-09-06T00:00:00.000Z', metadata: { ...provenance, duration_sec: 4.5, duration_source: 'audio_probe', voice_profile_id: 'v1', chunk_artifact_ids: [] } },
      { artifact_id: 'subtitle', artifact_type: 'subtitle_track', origin: 'local', file_uri: '/captions.srt', created_at: '2026-09-06T00:00:00.000Z', metadata: { ...provenance, format: 'srt', source_tts_artifact_id: 'audio', caption_count: 1, subtitle_revision_id: 'sub1', subtitle_settings_hash: h, subtitle_style: DEFAULT_SUBTITLE_STYLE } },
    ],
    audio_summary: { ...old.audio_summary, tts_merged_artifact_id: 'audio', subtitle_artifact_id: 'subtitle' },
    segment_routes: [ ...(startMs > 0 ? [{ ...route, segment_id: 'leading', narrationRange: { startMs: 0, endMs: startMs } }] : []), { ...route, narrationRange: { startMs, endMs } } ],
  };
}

describe('R1 F3 v2范围必须位于绑定音频内', () => {
  it.each([[4499, 9000], [9000, 9500]])('资产计划拒绝越界%s', (start, end) => {
    expect(parses('VersionedAssetPlan', planWithInterval(start, end))).toBe(false);
  });
  it.each([[4499, 9000], [9000, 9500]])('manifest拒绝越界%s', (start, end) => {
    expect(parses('VersionedAssetManifest', manifestWithInterval(start, end))).toBe(false);
  });
  it('范围终点等于音频结尾仍合法', () => {
    expect(parses('VersionedAssetPlan', planWithInterval(4499, 4500))).toBe(true);
    expect(parses('VersionedAssetManifest', manifestWithInterval(4499, 4500))).toBe(true);
  });
});
it('R1 F1 静默标点间隔仍执行前侧优先', () => {
  for (const side of ['previous', 'next'] as const) {
    const map = zeroChoiceMap(side);
    map.sourceText = '甲，乙丙';
    map.tokens[1].sourceStart = 2;
    map.tokens[1].sourceEnd = 3;
    map.tokens[2].sourceStart = 3;
    map.tokens[2].sourceEnd = 4;
    map.sourceSpans[0].sourceEnd = side === 'previous' ? 3 : 1;
    map.sourceSpans[1].sourceStart = side === 'previous' ? 3 : 2;
    map.sourceSpans[1].sourceEnd = 4;
    map.boundaries[1].sourceOffset += 1;
    map.boundaries[1].rawCandidateSourceOffsets = [2, 3];
    map.boundaries[1].legalCandidateSourceOffsets = [map.boundaries[1].sourceOffset];
    map.boundaries[2].sourceOffset = 4;
    map.boundaries[2].rawCandidateSourceOffsets = [4];
    map.boundaries[2].legalCandidateSourceOffsets = [4];
    expect(parses('NarrationTimingMapV1', map)).toBe(side === 'previous');
  }
});
function completeBoundary(offset: number, ms: number, left: string | null, right: string | null) {
  return {
    id: 'b' + offset,
    sourceOffset: offset,
    visualTimeMs: ms,
    leftTokenId: left,
    rightTokenId: right,
    ruleVersion: 'narration-boundaries/v1',
    rawCandidateSourceOffsets: [offset],
    legalCandidateSourceOffsets: [offset],
    selectionReason: left === null || right === null ? 'edge' : 'maximum_legal_source_offset',
  };
}
function twoGraphemeMap(first: string) {
  const length = first.length;
  return {
    ...timing(),
    sourceText: first + '甲',
    spokenText: first + '甲',
    durationMs: 500,
    tokens: [
      {
        ...token(0),
        spokenText: first,
        sourceEnd: length
      },
      {
        ...token(1),
        spokenText: '甲',
        sourceStart: length,
        sourceEnd: length + 1
      },
    ],
    sourceSpans: [
      { ...timing().sourceSpans[0], sourceEnd: length },
      {
        ...timing().sourceSpans[1],
        sourceStart: length,
        sourceEnd: length + 1
      },
    ],
    boundaries: [
      completeBoundary(0, 0, null, 'w0'),
      completeBoundary(length, 250, 'w0', 'w1'),
      completeBoundary(length + 1, 500, 'w1', null),
    ],
  };
}
describe('R1 完整UTF-16与规范化source证据', () => {
  it.each(['😀', 'é'])('完整字素可解析且%s内部不得切开', (first) => {
    const valid = twoGraphemeMap(first);
    expect(parses('NarrationTimingMapV1', valid)).toBe(true);
    const split = structuredClone(valid);
    split.tokens[0].sourceEnd = 1;
    split.sourceSpans[0].sourceEnd = 1;
    split.tokens[1].sourceStart = 1;
    split.sourceSpans[1].sourceStart = 1;
    split.boundaries[1] = completeBoundary(1, 250, 'w0', 'w1');
    expect(parses('NarrationTimingMapV1', split)).toBe(false);
  });
  it('数字12的十/二两个原生token共用source且不可拆成两个片段', () => {
    const map = {
      ...timing(),
      sourceText: '12',
      spokenText: '十二',
      durationMs: 500,
      tokens: [
        {
          ...token(0),
          sourceStart: 0,
          sourceEnd: 2,
          spokenText: '十'
        },
        {
          ...token(1),
          sourceStart: 0,
          sourceEnd: 2,
          spokenText: '二'
        },
      ],
      sourceSpans: [{
        id: 's0',
        sourceStart: 0,
        sourceEnd: 2,
        startMs: 0,
        endMs: 500,
        tokenIds: ['w0', 'w1'],
        mergeReason: 'shared_source_span'
      }],
      boundaries: [completeBoundary(0, 0, null, 'w0'), completeBoundary(2, 500, 'w1', null)],
    };
    expect(parses('NarrationTimingMapV1', map)).toBe(true);
    const split = {
      ...map, sourceSpans: map.tokens.map(t => ({
        id: 's-' + t.id,
        sourceStart: t.sourceStart,
        sourceEnd: t.sourceEnd,
        startMs: t.startMs,
        endMs: t.endMs,
        tokenIds: [t.id],
        mergeReason: 'positive_native_token',
      })),
    };
    expect(parses('NarrationTimingMapV1', split)).toBe(false);
    expect(parses('NarrationTimingMapV1', {
      ...map, boundaries: [map.boundaries[0], completeBoundary(1, 250, 'w0', 'w1'), map.boundaries[1]],
    })).toBe(false);
  });
});

function expandedNumberWithZero(position: 'head' | 'tail') {
  const head = position === 'head';
  const tokens = head ? [
    {
      ...token(0),
      spokenText: '啊',
      startMs: 0,
      endMs: 0
    },
    {
      ...token(1),
      spokenText: '十',
      sourceStart: 1,
      sourceEnd: 3,
      startMs: 0,
      endMs: 250
    },
    {
      ...token(2),
      spokenText: '二',
      sourceStart: 1,
      sourceEnd: 3,
      startMs: 250,
      endMs: 500
    },
  ] : [
    {
      ...token(0),
      spokenText: '十',
      sourceStart: 0,
      sourceEnd: 2
    },
    {
      ...token(1),
      spokenText: '二',
      sourceStart: 0,
      sourceEnd: 2
    },
    {
      ...token(2),
      spokenText: '了',
      startMs: 500,
      endMs: 500
    },
  ];
  const boundaries = [completeBoundary(0, 0, null, 'w0'), completeBoundary(3, 500, 'w2', null)];
  if (head) boundaries[0].rawCandidateSourceOffsets = [0, 1];
  else boundaries[1].rawCandidateSourceOffsets = [2, 3];
  return {

    ...timing(),
    sourceText: head ? '啊12' : '12了',
    spokenText: head ? '啊十二' : '十二了',

    durationMs: 500,
    tokens,

    sourceSpans: [{

      id: 's0',
      sourceStart: 0,
      sourceEnd: 3,
      startMs: 0,
      endMs: 500,

      tokenIds: ['w0', 'w1', 'w2'],
      mergeReason: 'shared_source_span_with_zero_duration_members',

    }],

    boundaries,

  };
}
describe('R2 F4 不可拆片段闭合共享来源与合法零点关系', () => {
  it.each(['head', 'tail'] as const)('接受数字展开组合%s零点且原token不变', (position) => {
    const input = expandedNumberWithZero(position);
    const originalTokens = structuredClone(input.tokens);
    const result = shared.NarrationTimingMapV1.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.tokens).toEqual(originalTokens);
    expect(result.data.sourceSpans[0].tokenIds).toEqual(['w0', 'w1', 'w2']);
    expect(result.data.boundaries.map(b => b.visualTimeMs)).toEqual([0, 500]);
  });
  it.each(['head', 'tail'] as const)('拒绝组合%s零点跨句', (position) => {
    const input = expandedNumberWithZero(position);
    if (position === 'head') input.tokens.slice(1).forEach(t => { t.providerSentenceIndex = 1; });
    else input.tokens[2].providerSentenceIndex = 1;
    expect(parses('NarrationTimingMapV1', input)).toBe(false);
  });
  it.each(['head', 'tail'] as const)('拒绝组合%s零点没有共享原生端点', (position) => {
    const input = expandedNumberWithZero(position);
    if (position === 'head') input.tokens[1].startMs = 1;
    else input.tokens[2].startMs = input.tokens[2].endMs = 501;
    if (position === 'tail') {
      input.durationMs = 501;
      input.sourceSpans[0].endMs = 501;
      input.boundaries[1].visualTimeMs = 501;
    }
    expect(parses('NarrationTimingMapV1', input)).toBe(false);
  });
  it('拒绝把数字以外的独立positive人为并入闭包', () => {
    const input = expandedNumberWithZero('tail');
    input.sourceText = '123';
    input.spokenText = '十二三';
    input.tokens[2].spokenText = '三';
    input.tokens[2].endMs = 750;
    input.durationMs = 750;
    input.sourceSpans[0].endMs = 750;
    input.boundaries[1].visualTimeMs = 750;
    input.boundaries[1].rawCandidateSourceOffsets = [3];
    for (const mergeReason of ['shared_source_span', 'shared_source_span_with_zero_duration_members']) {
      input.sourceSpans[0].mergeReason = mergeReason;
      expect(parses('NarrationTimingMapV1', input)).toBe(false);
    }
  });
  it('一个数字source可同时包含正时长与零时长原生成员', () => {
    const input = {

      ...timing(),
      sourceText: '12',
      spokenText: '十二',
      durationMs: 250,

      tokens: [
        {
          ...token(0),
          sourceStart: 0,
          sourceEnd: 2,
          spokenText: '十'
        },
        {
          ...token(1),
          sourceStart: 0,
          sourceEnd: 2,
          spokenText: '二',
          startMs: 250,
          endMs: 250
        },
      ],

      sourceSpans: [{
        id: 's0',
        sourceStart: 0,
        sourceEnd: 2,
        startMs: 0,
        endMs: 250,
        tokenIds: ['w0', 'w1'],
        mergeReason: 'zero_duration_run_attached_to_previous_shared_end'
      }],

      boundaries: [completeBoundary(0, 0, null, 'w0'), completeBoundary(2, 250, 'w1', null)],

    };
    expect(parses('NarrationTimingMapV1', input)).toBe(true);
    const overlap = structuredClone(input);
    overlap.sourceText = '123';
    overlap.tokens[1].sourceStart = 1;
    overlap.tokens[1].sourceEnd = 3;
    overlap.sourceSpans[0].sourceEnd = 3;
    overlap.boundaries[1] = completeBoundary(3, 250, 'w1', null);
    expect(parses('NarrationTimingMapV1', overlap)).toBe(false);
  });
});

it('R2 F4 同source内部零点依其原生target校验而非最终片段首尾', () => {
  const input = {

    ...timing(),
    sourceText: '12',
    spokenText: '一十二',
    durationMs: 500,

    tokens: [
      {
        ...token(0),
        sourceStart: 0,
        sourceEnd: 2,
        spokenText: '一'
      },
      {
        ...token(1),
        sourceStart: 0,
        sourceEnd: 2,
        spokenText: '十',
        startMs: 250,
        endMs: 250
      },
      {
        ...token(2),
        sourceStart: 0,
        sourceEnd: 2,
        spokenText: '二',
        startMs: 250,
        endMs: 500
      },
    ],

    sourceSpans: [{
      id: 's0',
      sourceStart: 0,
      sourceEnd: 2,
      startMs: 0,
      endMs: 500,
      tokenIds: ['w0', 'w1', 'w2'],
      mergeReason: 'shared_source_span_with_zero_duration_members'
    }],

    boundaries: [completeBoundary(0, 0, null, 'w0'), completeBoundary(2, 500, 'w2', null)],

  };
  const result = shared.NarrationTimingMapV1.safeParse(input);
  expect(result.success).toBe(true);
  if (!result.success) throw result.error;
  expect(result.data.tokens[1]).toEqual(input.tokens[1]);
  const invalid = structuredClone(input);
  invalid.tokens[1].startMs = invalid.tokens[1].endMs = 251;
  invalid.tokens[2].startMs = 252;
  expect(parses('NarrationTimingMapV1', invalid)).toBe(false);
});

function expectTimingZodFailure(input: unknown) {
  const result = shared.NarrationTimingMapV1.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('非法时间图被接受');
  expect(result.error.name).toBe('ZodError');
  expect(result.error.issues.length).toBeGreaterThan(0);
}

function emptyTimingMembers() {
  const input = timing();
  input.tokens = [];
  input.sourceSpans = [];
  input.boundaries = [input.boundaries[0], input.boundaries.at(-1)!];
  return input;
}

describe('R3 F5 外部输入下限失败稳定返回ZodError', () => {
  it('空tokens与空spans保留完整首尾边界', () => {
    expectTimingZodFailure(emptyTimingMembers());
  });
  it.each([
    ['缺失边界', undefined],
    ['空边界数组', []],
    ['结构畸形边界', [{}]],
  ])('空成员组合%s', (_name, boundaries) => {
    expectTimingZodFailure({ ...emptyTimingMembers(), boundaries });
  });
  it('空成员组合候选数组下限失败的边界', () => {
    const input = emptyTimingMembers();
    input.boundaries[0].rawCandidateSourceOffsets = [];
    expectTimingZodFailure(input);
  });
  it('空成员组合仅一条首边界', () => {
    const input = emptyTimingMembers();
    input.boundaries.pop();
    expectTimingZodFailure(input);
  });
  const dirtyCases: Array<[string, (input: ReturnType<typeof timing>) => void]> = [
    ['仅tokens为空', input => { input.tokens = []; }],
    ['仅sourceSpans为空', input => { input.sourceSpans = []; }],
    ['span成员为空', input => { input.sourceSpans[0].tokenIds = []; }],
    ['边界合法候选为空', input => { input.boundaries[0].legalCandidateSourceOffsets = []; }],
    ['token重复id且span成员对应重复', input => {
      input.tokens[1].id = input.tokens[0].id;
      input.sourceSpans[1].tokenIds = [input.tokens[0].id];
    }],
    ['sourceSpan重复id', input => { input.sourceSpans[1].id = input.sourceSpans[0].id; }],
    ['boundary重复id', input => { input.boundaries[1].id = input.boundaries[0].id; }],
    ['token与span同时倒序', input => {
      input.tokens.reverse();
      input.sourceSpans.reverse();
    }],
    ['provider tuple少成员', input => { input.tokens[0].providerIndexRange = []; }],
    ['所有token均为零且无可归属positive', input => {
      input.tokens.forEach(token => { token.endMs = token.startMs; });
    }],
    ['空文本与空成员组合', input => {
      input.sourceText = '';
      input.spokenText = '';
      input.tokens = [];
      input.sourceSpans = [];
    }],
  ];
  it.each(dirtyCases)('%s稳定拒绝', (_name, change) => {
    const input = timing();
    change(input);
    expectTimingZodFailure(input);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('数值非法%s与空成员组合稳定拒绝', value => {
    const input = emptyTimingMembers();
    input.durationMs = value;
    input.boundaries[0].visualTimeMs = value;
    expectTimingZodFailure(input);
  });
});

describe('任务3真实WS请求身份', () => {
  const ready = (status: 'ready' | 'confirmed') => ({ ...record(), status, providerTaskId: 'native-task-id', providerRequestId: null, output: output(),
    ...(status === 'confirmed' ? {confirmedAt:'2026-09-06T00:00:00.000Z',confirmedBy:'user1',acceptedDurationBandSnapshot:{minMs:500,maxMs:2000}} : {}) });
  it.each(['ready','confirmed'] as const)('%s允许真实缺省request_uuid且保留taskId', status => {
    const value=ready(status); expect(shared.NarrationRecord.safeParse(value).success).toBe(true);
  });
  it.each(['ready','confirmed'] as const)('%s仍拒绝缺taskId、空requestId和无音频bundle', status => {
    const value=ready(status);
    expect(shared.NarrationRecord.safeParse({...value,providerTaskId:null}).success).toBe(false);
    expect(shared.NarrationRecord.safeParse({...value,providerRequestId:''}).success).toBe(false);
    expect(shared.NarrationRecord.safeParse({...value,output:null}).success).toBe(false);
  });
});
