/** 任务 0 人工发声起点量尺。只读既有采集，不外呼、不授予模型资格。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectEvidence, type NativeToken, type NormalizationObservation } from './narration-evidence-inspector.js';
import type evidenceType from '../../samples/narration-timing/boundary-review-evidence.json';

const hash = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FROZEN_HASH = '9af4a6d558d7102c34c0015b9d0ffedfef1d4f85a4f170062f4569a6e7068a73';
interface Identity {
  candidate_id: string; model: string; voice: string; region: string; protocol: string;
  input_mode: string; parameters_version: string; parameters: object;
}
/** 由 CLI 的冻结原件构建；单测可传隔离的协议 fixture。 */
export function makeBoundaryCase(input: {
  identity: Identity; sourceText: string; pcm: Buffer; capture: unknown;
  observations?: NormalizationObservation[]; audioFile?: string; wavSha256?: string;
}) {
  const inspection = inspectEvidence({ ...input, sourceSha256: hash(input.sourceText), audioSha256: hash(input.pcm) });
  const raw = input.capture as { events: Array<{ data?: any }> };
  const words: NativeToken[] = raw.events.flatMap(e => e.data?.payload?.output?.type === 'sentence-end' ? e.data.payload.output.sentence.words : []);
  const eligible = words.map((w, i) => ({ w, i })).filter(({ w }) => /[\p{L}\p{N}]/u.test(w.text));
  if (eligible.length < 30) throw Error('review_sample_insufficient');
  const selected = new Set<number>([eligible[0].i, eligible.at(-1)!.i]);
  // 不能为了好看的统计跳过正文零时长、越界或重叠点。
  for (const { w, i } of eligible) if (w.end_time <= w.begin_time || w.begin_time < 0 || w.end_time > inspection.duration_ms || i > 0 && w.begin_time < words[i - 1].end_time) selected.add(i);
  const target = Math.max(30, selected.size);
  for (let n = 0; n < 30 && selected.size < target; n++) selected.add(eligible[Math.round(n * (eligible.length - 1) / 29)].i);
  for (const { i } of eligible) { if (selected.size >= target) break; selected.add(i); }
  const rows = [...selected].sort((a, b) => a - b).map(i => ({
    id: 'token-' + i + '-onset', token_ordinal: i, token_text: words[i].text,
    context: words.slice(Math.max(0, i - 5), i).map(w => w.text).join('') + '【' + words[i].text + '】' + words.slice(i + 1, i + 6).map(w => w.text).join(''),
    search_from_ms: Math.max(0, Math.floor(words[i].begin_time / 5000) * 5000 - 5000),
    native_ms: words[i].begin_time,
  }));
  const reference = {
    identity: input.identity, source_sha256: hash(input.sourceText), audio_sha256: hash(input.pcm),
    native_event_sha256: inspection.native_event_sha256, wav_sha256: input.wavSha256 ?? null,
    duration_ms: inspection.duration_ms, sampling_version: 'spread-plus-anomalies-onset-v1', rows,
    structural_issues: [...inspection.timing_issues, ...(inspection.text_mapping.status === 'mismatch' ? ['source_mapping_mismatch'] : [])],
    mapping_status: inspection.text_mapping.status,
  };
  return { ...reference, evidence_id: hash(JSON.stringify(reference)), audio_file: input.audioFile ?? null };
}
type BoundaryCase = ReturnType<typeof makeBoundaryCase>;
type Status = 'unreviewed' | 'measured' | 'inaudible' | 'uncertain';
export function createReviewForm(cases: BoundaryCase[]) {
  return { schema_version: 'narration_manual_onset_review_v1', cases: cases.map(c => ({
    candidate_id: c.identity.candidate_id, evidence_id: c.evidence_id,
    rows: c.rows.map(({ native_ms: _native, ...r }) => ({ ...r, status: 'unreviewed' as Status, measured_ms: null as number | null, reviewer: '', note: '' })),
  })) };
}
function objectWithKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
export function evaluateReview(cases: BoundaryCase[], form: unknown) {
  if (!objectWithKeys(form, ['schema_version', 'cases']) || form.schema_version !== 'narration_manual_onset_review_v1' || !Array.isArray(form.cases) || form.cases.length !== cases.length) throw Error('review_form_invalid');
  const expected = createReviewForm(cases);
  const seen = new Set<string>();
  const results = form.cases.map((f: unknown) => {
    if (!objectWithKeys(f, ['candidate_id', 'evidence_id', 'rows']) || seen.has(f.candidate_id)) throw Error('review_form_invalid');
    seen.add(f.candidate_id);
    const c = cases.find(c => c.identity.candidate_id === f.candidate_id);
    const blank = expected.cases.find(c => c.candidate_id === f.candidate_id);
    if (!c || !blank || f.evidence_id !== c.evidence_id || !Array.isArray(f.rows) || f.rows.length !== c.rows.length) throw Error('review_form_invalid');
    const rowIds = new Set<string>();
    const measured: Array<{ ordinal: number; ms: number; error: number }> = [];
    const missing: Array<{ id: string; status: Status; note: string }> = [];
    for (const row of f.rows) {
      if (!objectWithKeys(row, Object.keys(blank.rows[0])) || rowIds.has(row.id)) throw Error('review_form_invalid');
      rowIds.add(row.id);
      const target = blank.rows.find(r => r.id === row.id);
      if (!target) throw Error('review_form_invalid');
      for (const key of ['id', 'token_ordinal', 'token_text', 'context', 'search_from_ms'] as const) if (row[key] !== target[key]) throw Error('review_form_invalid');
      if (!['unreviewed', 'measured', 'inaudible', 'uncertain'].includes(row.status) || typeof row.reviewer !== 'string' || typeof row.note !== 'string') throw Error('review_measurement_invalid');
      if (row.status === 'measured') {
        if (!row.reviewer.trim() || !Number.isSafeInteger(row.measured_ms) || row.measured_ms < 0 || row.measured_ms >= c.duration_ms) throw Error('review_measurement_invalid');
        measured.push({ ordinal: target.token_ordinal, ms: row.measured_ms, error: Math.abs(row.measured_ms - c.rows.find(r => r.id === row.id)!.native_ms) });
      } else {
        if (row.measured_ms !== null || row.status !== 'unreviewed' && (!row.reviewer.trim() || !row.note.trim())) throw Error('review_measurement_invalid');
        missing.push({ id: row.id, status: row.status, note: row.note });
      }
    }
    measured.sort((a, b) => a.ordinal - b.ordinal);
    if (measured.some((m, i) => i > 0 && m.ms <= measured[i - 1].ms)) throw Error('review_measurement_invalid');
    const errors = measured.map(m => m.error).sort((a, b) => a - b);
    const complete = !missing.length && errors.length >= 30;
    const p95 = complete ? errors[Math.ceil(errors.length * 0.95) - 1] : null;
    const max = complete ? errors.at(-1)! : null;
    return { candidate_id: c.identity.candidate_id, evidence_id: c.evidence_id,
      sample_scope: 'frozen_long_audio_token_onsets_only', status: missing.some(m => m.status === 'inaudible') ? 'audio_issue' : !complete ? 'pending' : p95! <= 200 && max! <= 500 ? 'within_target' : 'outside_target',
      required_onset_count: c.rows.length, manual_onset_count: measured.length, p95_ms: p95, max_ms: max,
      missing, structural_issues: c.structural_issues, qualification: 'unverified',
    };
  });
  return { actual_requests: 0, qualification: 'unverified', percentile_method: 'nearest_rank',
    thresholds_ms: { p95: 200, max: 500 }, cases: results };
}
/** 整个索引及每份原件都固定；评估不信任用户表附带的原生时间/媒体信息。 */
export function loadReviewCases(read: (path: string) => Buffer = readFileSync) {
  const index: typeof evidenceType = JSON.parse(readFileSync(local('../../samples/narration-timing/boundary-review-evidence.json'), 'utf8'));
  if (hash(JSON.stringify(index)) !== FROZEN_HASH) throw Error('review_evidence_index_changed');
  const pinned = (p: { path: string; sha256: string }) => {
    const bytes = read(local('./output/' + p.path));
    if (hash(bytes) !== p.sha256) throw Error('review_evidence_changed');
    return bytes;
  };
  pinned(index.report);
  const sourceText = pinned(index.source).toString('utf8');
  // 本次对照已记录的17处换行删除，只为诊断映射；不推断发音规则。
  const observations = [...sourceText.matchAll(/\n/g)].map(m => ({ start: m.index!, end: m.index! + 1, expected: '\n', spoken: '' }));
  return index.cases.map(c => {
    pinned(c.wav); pinned(c.outbound);
    return makeBoundaryCase({ identity: c.identity, sourceText, pcm: pinned(c.pcm), capture: JSON.parse(pinned(c.events).toString('utf8')), observations,
      audioFile: local('./output/' + c.wav.path), wavSha256: c.wav.sha256 });
  });
}
export function runBoundaryReview(argv: string[]) {
  if (!argv.length) return { actual_requests: 0, usage: '--prepare <新目录> 或 --evaluate <人工填写后的review.json>；仅使用冻结的自然段长稿原件' };
  if (argv.length !== 2 || !['--prepare', '--evaluate'].includes(argv[0]) || !argv[1] || argv[1].startsWith('--')) throw Error('offline_arguments_invalid');
  const cases = loadReviewCases();
  if (argv[0] === '--evaluate') return evaluateReview(cases, JSON.parse(readFileSync(resolve(argv[1]), 'utf8')));
  return writeReviewPack(resolve(argv[1]), cases);
}
export function writeReviewPack(dir: string, cases: BoundaryCase[]) {
  mkdirSync(dir); // 不覆盖已有人工表或半成品。
  writeFileSync(resolve(dir, 'review.json'), JSON.stringify(createReviewForm(cases), null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(dir, 'reference.json'), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
  const instructions = [
    '# 人工发声起点核验（仅现有长稿样本）', '',
    '用可查看波形和毫秒位置的音频编辑器打开以下完整 WAV；保持原速，音频起点为0。PCM按s16le/单声道/24kHz封装仍是待听审确认的布局假设。',
    ...cases.map(c => '- ' + c.identity.candidate_id + '：' + c.audio_file), '',
    'review.json 中 context 是原生 token 上下文，不保证等于原文。search_from_ms 只是大致查找起点；找不到时扩大到全文，不得把提示时间当答案。',
    '每行填写 status、measured_ms、reviewer、note，其他字段保留。measured_ms 是【目标token首次实际发声】相对完整音频的整数毫秒，不是秒数或片段内时间。',
    '实测填 measured；听不到目标词填 inaudible；无法可靠定位填 uncertain。后两者保持 measured_ms=null，并填写 reviewer 和 note。未审保持 unreviewed/null。',
    '若两个目标无法区分为不同发声起点，应标 uncertain，不能重复时间充数。不要根据 reference.json 的原生时间填答案；该文件仅供测量完成后的核对。',
    '全部固定点实测完成才计算P95/max；该统计只覆盖抽样发声起点，不代替全文/发声终点/布局听审或三稿盲听评分。即使 within_target，qualification 仍为 unverified，既有结构问题不消失。',
    '保存后运行：node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-boundary-review.ts --evaluate "' + resolve(dir, 'review.json') + '"', '',
  ].join('\n');
  writeFileSync(resolve(dir, 'README.md'), instructions, { flag: 'wx' });
  return { actual_requests: 0, qualification: 'unverified', review_path: resolve(dir, 'review.json'), cases: cases.map(c => ({ candidate_id: c.identity.candidate_id, prepared_onset_count: c.rows.length, manual_onset_count: 0 })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(runBoundaryReview(process.argv.slice(2)), null, 2) + '\n'); }
  catch (e) { process.stderr.write(JSON.stringify({ error: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'review_input_or_io_failed' }) + '\n'); process.exitCode = 1; }
}
