import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// 独立试调：只读已有运行记录与 prompts/ 下的正式 prompt，不写业务数据库，不改正式视频生成链路。
// 鉴权、单次提交保护、轮询、产物保存沿用 autodl-video-smoke.mjs 的既有约定。
const OUT = resolve('harness/scripts/runtime/output/protoface-ltx-s029');
const PROMPT_FILE = resolve('prompts/asset/protoface-ltx-video-smoke.prompt.md');
const MODEL_ID = 'lightricks/ltx-2.5-fast';
const BASE = 'https://api.protoface.com/v1';
const TOKEN_ENV = 'PROTOFACE_API_KEY';
// 官网公开标价：720p 档 $0.006/秒；平台计费单位为 credit，1 credit = $0.01。
const PRICE_PER_SECOND_USD = 0.006;
const CREDIT_USD = 0.01;
const ASSET_MODALITY = 'image';
// 必须声明真实图片 MIME。传 application/octet-stream 时平台会按不透明二进制入库
// （media_type=application/octet-stream、宽高为 null、落盘为 source.bin），
// 下游供应商随即报 "This image format is not supported. Use JPEG, PNG, or WebP."。
const ASSET_MIME = 'image/png';
const ASSET_FILENAME = 'reference.png';
const SOURCE = {
  assetRunId: 'assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9',
  taskId: 'video_029',
  projectDir: 'storage/projects/2026-08-05/装病十年的野心家，一朝发难尽诛曹氏 [p_e115c849]',
  originalModel: 'wan2.7-i2v-2026-04-25',
  originalParameters: { resolution: '720P', duration: 10, prompt_extend: true, watermark: false },
  originalVideoRelative: 'assets-runs/assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9/videos/dashscope_video_029.mp4',
};
// 本次意图：恰好 10 秒、官网 720p 档（该档实际输出 768p）、竖屏 9:16（与参考图一致）。
// quality 必须传档位名 "720p"（平台枚举 480p/720p/1080p），不能传实际画布 "768p"。
// generate_audio 默认 true：音频与画面同一次推理产出，关掉也不降价，且本次需要取出音轨做人声检查。
const INTENT = { durationSeconds: 10, quality: '720p', aspectRatio: '9:16', generateAudio: true };
const AUDIO_LINE_PREFIX = '【音频约束】';
// 字段名一律以 GET /v1/models/{id} 返回的 schema 为准，不猜接口。
// 实测 LTX 2.5 Fast（video.general）的首帧字段是 image_url，不是 first_frame。
const FIELD_CANDIDATES = {
  prompt: ['prompt'],
  duration_seconds: ['duration_seconds', 'duration'],
  quality: ['quality', 'resolution'],
  aspect_ratio: ['aspect_ratio', 'aspectRatio'],
  first_frame: ['image_url', 'first_frame', 'image', 'start_image', 'init_image'],
  generate_audio: ['generate_audio'],
  operation: ['operation'],
};
const TERMINAL_OK = ['completed'];
const TERMINAL_BAD = ['failed', 'canceled'];

const outPath = name => resolve(OUT, name);
const save = (name, value) => writeFileSync(outPath(name), JSON.stringify(value, null, 2));
const load = name => JSON.parse(readFileSync(outPath(name), 'utf8'));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
mkdirSync(OUT, { recursive: true });

function promptBody() {
  const raw = readFileSync(PROMPT_FILE, 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('正式 prompt 文件缺少合法 frontmatter：' + PROMPT_FILE);
  return match[1].trim();
}

function readToken() {
  const fromEnv = process.env[TOKEN_ENV];
  const file = outPath('token.txt');
  const fromFile = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const token = (fromEnv ?? fromFile).trim();
  if (!token || token.includes('请在此填写') || !token.startsWith('sk_')) {
    throw new Error(`缺少可用令牌：请把 Protoface API Key 写入 ${file}，或设置环境变量 ${TOKEN_ENV}。不要在聊天中粘贴令牌。`);
  }
  return token;
}

// 统一脱敏：任何回显、落盘都不得包含令牌或 data URI 正文。
function redact(value, token) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (token) text = text.split(token).join('[已隐藏令牌]');
  return text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:<已省略base64>');
}

async function api(path, { method = 'GET', body, token, form, timeoutMs = 120000 } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE + path, {
    method,
    redirect: 'error',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(form ? { body: form } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  return { ok: response.ok, status: response.status, json };
}

function assertOk(result, what) {
  if (result.ok) return result.json;
  const err = result.json?.error ?? {};
  throw new Error(`${what} 失败：HTTP ${result.status} ${err.type ?? ''} ${err.code ?? ''} ${err.message ?? ''}`.trim());
}

function collectSchemaKeys(node, acc = new Set(), depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaKeys(item, acc, depth + 1);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    acc.add(key);
    collectSchemaKeys(value, acc, depth + 1);
  }
  return acc;
}

// 只取“名为该字段”的 schema 节点，避免把无关的数值枚举（如 fps）当成时长。
function findFieldNodes(node, fieldName, acc = [], depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) findFieldNodes(item, fieldName, acc, depth + 1);
    return acc;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === fieldName && value && typeof value === 'object' && !Array.isArray(value)) acc.push(value);
    findFieldNodes(value, fieldName, acc, depth + 1);
  }
  return acc;
}

function describeField(model, fieldName) {
  const nodes = findFieldNodes(model, fieldName);
  const enums = [...new Set(nodes.flatMap(n => (Array.isArray(n.enum) ? n.enum : [])).map(v => (typeof v === 'number' ? v : String(v))))];
  const bounds = nodes.map(n => ({ enum: n.enum ?? null, minimum: n.minimum ?? null, maximum: n.maximum ?? null, default: n.default ?? null, description: n.description ?? null }));
  return { fieldName, enums, bounds, found: nodes.length > 0 };
}

// 从已发现的 schema 里解析字段名；解析不到就明确失败，不回退到猜测。
function resolveFields(model) {
  const keys = collectSchemaKeys(model);
  const resolved = {};
  const unresolved = [];
  for (const [role, candidates] of Object.entries(FIELD_CANDIDATES)) {
    const hit = candidates.find(name => keys.has(name));
    if (hit) resolved[role] = hit;
    else unresolved.push(`${role}（候选：${candidates.join(' / ')}）`);
  }
  return { resolved, unresolved, keys: [...keys].sort() };
}

function pickDuration(described, wanted) {
  const numbers = described.enums.map(Number).filter(n => Number.isFinite(n));
  const range = described.bounds.map(b => ({ minimum: b.minimum, maximum: b.maximum })).find(b => b.minimum !== null || b.maximum !== null) ?? null;
  const suffix = range ? `；schema 范围 ${JSON.stringify(range)}` : '';
  if (numbers.length === 0) return { value: wanted, note: `schema 未给出 ${described.fieldName} 的枚举值，按意图值提交${suffix}` };
  if (numbers.includes(wanted)) return { value: wanted, note: `意图时长 ${wanted} 秒在支持列表内（${numbers.join('/')}）` };
  const nearest = numbers.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a));
  return { value: nearest, note: `意图时长 ${wanted} 秒不受支持，取最接近的 ${nearest} 秒（差 ${Math.abs(nearest - wanted)} 秒）；支持列表 ${numbers.join('/')}` };
}

// 优先用平台返回的 pricing 矩阵，其次退回官网公开标价。
function estimateUsd(seconds, tier) {
  const tierPricing = tier?.credits_per_second;
  if (typeof tierPricing === 'number') {
    const credits = Math.max(Math.ceil(tierPricing * seconds), tier.minimum_credits ?? 0);
    return {
      seconds,
      credits,
      usd: credits * CREDIT_USD,
      usd_per_second: tierPricing * CREDIT_USD,
      output_label: tier.output_label ?? null,
      note: `平台 pricing 矩阵：${tierPricing} credits/秒 × ${seconds} 秒 = ${credits} credits（1 credit = $0.01，rounding=ceil_per_job，最低 ${tier.minimum_credits} credits）；实际以平台账单为准`,
    };
  }
  const usd = seconds * PRICE_PER_SECOND_USD;
  return { seconds, credits: Math.ceil(usd / CREDIT_USD), usd, note: '按官网公开标价 $0.006/秒 估算，实际以平台账单为准' };
}

async function main() {
  const mode = process.argv[2] ?? 'prepare';
  const approve = process.argv.includes('--approve');

  if (mode === 'prepare') {
    const db = new DatabaseSync(resolve('storage/history-video-forge.db'), { readOnly: true });
    const row = db.prepare('SELECT id, rawRequestJson FROM AssetProviderJobRecord WHERE assetRunId=? AND taskId=?').get(SOURCE.assetRunId, SOURCE.taskId);
    db.close();
    if (!row) throw new Error('未找到原分镜的视频请求记录');

    const original = JSON.parse(row.rawRequestJson);
    const image = original.payload.input.media[0].url;
    if (!image.startsWith('data:image/png;base64,')) throw new Error('参考图不是 PNG data URI，与原记录不符');
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    writeFileSync(outPath('reference.png'), bytes);

    const body = promptBody();
    const lines = body.split('\n');
    const audioLines = lines.filter(line => line.startsWith(AUDIO_LINE_PREFIX));
    if (audioLines.length !== 1) throw new Error('正式 prompt 必须恰好包含一行 ' + AUDIO_LINE_PREFIX + ' 音频约束');
    const withoutAudio = lines.filter(line => !line.startsWith(AUDIO_LINE_PREFIX)).join('\n').trim();
    if (withoutAudio !== original.payload.input.prompt.trim()) {
      throw new Error('正式 prompt 去掉音频约束后与原分镜提示词不一致，停止准备');
    }

    writeFileSync(outPath('prompt.txt'), body + '\n');
    const originalVideo = resolve(SOURCE.projectDir, SOURCE.originalVideoRelative);
    save('intent.json', { modelId: MODEL_ID, ...INTENT, audioConstraint: audioLines[0].trim(), note: '时长、分辨率、比例均需在 inspect 阶段对照平台 schema 复核' });
    save('source.json', {
      provider_job_record_id: row.id,
      asset_run_id: SOURCE.assetRunId,
      task_id: SOURCE.taskId,
      project_dir: SOURCE.projectDir,
      original_model: SOURCE.originalModel,
      original_parameters: SOURCE.originalParameters,
      original_video: originalVideo,
      original_video_exists: existsSync(originalVideo),
      original_prompt_sha256: sha256(Buffer.from(original.payload.input.prompt, 'utf8')),
      prompt_file: PROMPT_FILE,
      prompt_file_sha256: sha256(Buffer.from(body, 'utf8')),
      prompt_unchanged_except_audio_line: true,
      image_role: original.payload.input.media[0].role,
      image_sha256: sha256(bytes),
      image_bytes: bytes.length,
      image_size: statSync(outPath('reference.png')).size,
    });
    console.log('准备完成：原提示词（仅追加音频约束）、原参考图字节已就位；未调用付费接口。');
    console.log('参考图 bytes=' + bytes.length + ' sha256=' + sha256(bytes));
    console.log('原视频存在：' + existsSync(originalVideo));
    return;
  }

  if (mode === 'compare') {
    const { execFileSync } = await import('node:child_process');
    const probe = file => {
      if (!existsSync(file)) return null;
      const json = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames,sample_rate,channels:format=duration,size', '-of', 'json', file], { encoding: 'utf8' }));
      const video = json.streams.find(s => s.codec_type === 'video') ?? {};
      const audio = json.streams.find(s => s.codec_type === 'audio') ?? null;
      return {
        file,
        bytes: Number(json.format.size),
        duration_seconds: Number(json.format.duration),
        video: { codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames) },
        audio: audio ? { codec: audio.codec_name, sample_rate: audio.sample_rate, channels: audio.channels } : null,
      };
    };
    const original = probe(load('source.json').original_video);
    const generated = probe(outPath('protoface-ltx-s029.mp4'));
    save('compare.json', { original, generated, note: '仅 ffprobe 客观量测；音轨未被静音、裁剪或修改。人声有无需听感或 ASR 转写另行验证。' });
    console.log(JSON.stringify({ original, generated }, null, 2));
    if (original && generated) {
      console.log(`时长差：${(generated.duration_seconds - original.duration_seconds).toFixed(3)} 秒；分辨率 ${original.video.width}x${original.video.height} → ${generated.video.width}x${generated.video.height}`);
    }
    return;
  }

  const token = readToken();

  if (mode === 'inspect') {
    const model = assertOk(await api(`/models/${MODEL_ID}`, { token }), '读取模型目录');
    save('model.json', model);
    const { resolved, unresolved, keys } = resolveFields(model);
    save('schema-resolution.json', { model_id: MODEL_ID, resolved, unresolved, candidate_keys: keys });
    console.log('模型：' + model.id + '（revision ' + model.revision + '，available=' + model.available + '）');
    console.log('operations：' + JSON.stringify(model.operations));
    console.log('input_modalities：' + JSON.stringify(model.input_modalities) + '  output_modalities：' + JSON.stringify(model.output_modalities));
    console.log('pricing：' + JSON.stringify(model.pricing));
    console.log('output_quality_descriptions：' + JSON.stringify(model.output_quality_descriptions ?? null));
    console.log('已解析字段：' + JSON.stringify(resolved));
    console.log('未解析字段：' + (unresolved.length ? unresolved.join('；') : '无'));
    for (const role of ['duration_seconds', 'quality', 'aspect_ratio', 'first_frame', 'operation']) {
      if (!resolved[role]) continue;
      console.log(`schema[${role}] → ${resolved[role]}：` + JSON.stringify(describeField(model, resolved[role])));
    }
    save('field-notes.json', Object.fromEntries(['duration_seconds', 'quality', 'aspect_ratio', 'first_frame', 'operation'].filter(r => resolved[r]).map(r => [r, describeField(model, resolved[r])])));
    console.log('已保存 model.json 与 field-notes.json；本步骤不产生费用。');
    return;
  }

  if (mode === 'usage') {
    const tag = process.argv[3] ?? 'after';
    const usage = assertOk(await api('/usage', { token }), '读取用量');
    save(`usage-${tag}.json`, usage);
    console.log(`用量已保存到 usage-${tag}.json；credits_charged=` + JSON.stringify(usage.credits_charged ?? null));
    return;
  }

  if (mode === 'upload') {
    if (existsSync(outPath('asset.json'))) {
      console.log('asset.json 已存在，复用已上传参考图：' + load('asset.json').id);
      return;
    }
    const bytes = readFileSync(outPath('reference.png'));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: ASSET_MIME }), ASSET_FILENAME);
    form.append('modality', ASSET_MODALITY);
    const asset = assertOk(await api('/assets', { method: 'POST', token, form }), '上传参考图');
    // 上传结果必须被平台识别为图片，否则后续提交必然被供应商拒绝；发现不对立即停，不产生生成费用。
    if (!String(asset.media_type ?? '').startsWith('image/')) {
      throw new Error(`平台未把参考图识别为图片（media_type=${asset.media_type}，${asset.width}x${asset.height}）；请勿提交，先修正 MIME 声明。`);
    }
    save('asset.json', asset);
    console.log('参考图已上传为平台资产：' + asset.id + '（' + (asset.byte_size ?? bytes.length) + ' 字节，media_type=' + asset.media_type + '，' + asset.width + 'x' + asset.height + '）；上传不产生生成费用。');
    return;
  }

  if (mode === 'reset-after-failed') {
    // 仅在“已到终态失败且实扣 0 credits”时归档旧提交记录，允许修正后重投一次。
    // 结果未知或已扣费一律不清理，避免掩盖重复扣费。
    const failedFile = outPath('submission.json');
    if (!existsSync(failedFile)) throw new Error('没有提交记录，无需归档。');
    const submission = load('submission.json');
    const result = existsSync(outPath('result.json')) ? load('result.json') : null;
    const status = String(result?.status ?? '').toLowerCase();
    const charged = result?.credits?.charged;
    if (!TERMINAL_BAD.includes(status)) throw new Error(`上一任务不是终态失败（status=${status || '未知'}），不允许重投。`);
    if (charged !== 0) throw new Error(`上一任务 charged=${charged}，可能已扣费，不允许自动重投；请先人工核对账单。`);
    const archived = `submission-${submission.run_id || 'unknown'}-failed.json`;
    renameSync(failedFile, outPath(archived));
    console.log(`上一任务 ${submission.run_id} 终态失败且实扣 0 credits，已归档为 ${archived}；现在可以修正后重投。`);
    return;
  }

  if (!['submit', 'poll'].includes(mode)) {
    throw new Error('用法：node harness/scripts/runtime/protoface-ltx-video-smoke.mjs prepare|inspect|upload|submit|poll|usage|compare|reset-after-failed');
  }

  const stateFile = outPath('submission.json');
  if (mode === 'submit') {
    if (existsSync(stateFile)) throw new Error('已有提交记录，请使用 poll；未知提交结果不能自动重发。');
    if (!existsSync(outPath('model.json'))) throw new Error('缺少 model.json：请先运行 inspect 复核平台参数。');
    const model = load('model.json');
    const intent = load('intent.json');
    const { resolved, unresolved } = resolveFields(model);
    // generate_audio / operation 属可选角色：解析不到就不传，不阻塞提交。
    const REQUIRED_ROLES = ['prompt', 'duration_seconds', 'quality', 'aspect_ratio', 'first_frame'];
    const blocking = unresolved.filter(role => REQUIRED_ROLES.some(r => role.startsWith(r)));
    if (blocking.length) throw new Error('以下必需字段未能在平台 schema 中解析，禁止猜测提交：' + blocking.join('；'));
    if (unresolved.length) console.log('（可选字段未解析，将不传：' + unresolved.join('；') + '）');

    const allowedDurations = describeField(model, resolved.duration_seconds);
    const duration = pickDuration(allowedDurations, intent.durationSeconds);
    const qualityField = describeField(model, resolved.quality);
    const body = {
      [resolved.prompt]: readFileSync(outPath('prompt.txt'), 'utf8').trim(),
      [resolved.duration_seconds]: duration.value,
      [resolved.quality]: intent.quality,
      [resolved.aspect_ratio]: intent.aspectRatio,
    };
    if (resolved.operation) body[resolved.operation] = 'video.animate';
    if (resolved.generate_audio && intent.generateAudio === true) body[resolved.generate_audio] = true;
    if (existsSync(outPath('asset.json'))) body[resolved.first_frame] = load('asset.json').id;
    else body[resolved.first_frame] = 'data:image/png;base64,' + readFileSync(outPath('reference.png')).toString('base64');

    const qualityValues = qualityField.enums.map(String);
    if (qualityValues.length > 0 && !qualityValues.includes(intent.quality)) {
      throw new Error(`意图档位 ${intent.quality} 不在平台支持列表内：${qualityValues.join('/')}；请先核对 model.json 再决定，不自动改档位。`);
    }
    const tier = model.pricing?.qualities?.[intent.quality] ?? null;
    if (tier?.minimum_seconds && duration.value < tier.minimum_seconds) {
      throw new Error(`${intent.quality} 档最短 ${tier.minimum_seconds} 秒，本次 ${duration.value} 秒不合法；不自动改规格。`);
    }
    const qualityNote = `平台档位枚举 ${qualityValues.join('/')}，传档位名 "${intent.quality}"（不能传实际画布名）；该档 output_label=${tier?.output_label ?? '未知'}，即实际画布 ${tier?.output_label ?? '?'}`;
    const cost = estimateUsd(duration.value, tier);
    const record = {
      model_id: MODEL_ID,
      model_revision: model.revision,
      endpoint: `POST ${BASE}/run/${MODEL_ID}`,
      body_redacted: { ...body, [resolved.first_frame]: redact(body[resolved.first_frame], token) },
      field_resolution: resolved,
      duration_note: duration.note,
      quality_note: qualityNote,
      aspect_ratio_note: `平台枚举 ${describeField(model, resolved.aspect_ratio).enums.join('/')}；参考图 1080x1920 为 9:16`,
      enhance_prompt_note: '平台 enhance_prompt 默认 false，本次不开启，以保留含音频约束的原文；原 dashscope 请求为 prompt_extend=true，此处与原始调用不同，属已知差异。',
      image_source: existsSync(outPath('asset.json')) ? 'platform asset ' + load('asset.json').id : 'data URI',
      estimate: cost,
      approved: approve,
      at: new Date().toISOString(),
    };
    save('request.json', record);
    console.log('=== 本次实际输入 ===');
    console.log('模型：' + MODEL_ID + '（revision ' + model.revision + '）');
    console.log('提示词：' + record.body_redacted[resolved.prompt]);
    console.log('首帧字段：' + resolved.first_frame + ' = ' + redact(body[resolved.first_frame], token).slice(0, 60) + '…');
    console.log('时长：' + duration.value + ' 秒（' + duration.note + '）');
    console.log('档位：' + intent.quality + ' → 实际输出 ' + (tier?.output_label ?? '?'));
    console.log('比例：' + intent.aspectRatio);
    console.log('音频：generate_audio=' + (body[resolved.generate_audio] ?? '(未传，平台默认 true)'));
    console.log('=== 预计费用 ===');
    console.log(`${cost.note} → 预计 $${cost.usd} ≈ ¥${(cost.usd * 7).toFixed(2)}`);
    if (!approve) {
      console.log('未传 --approve：仅展示，不提交。');
      return;
    }
    // 写入意向后只发一次；网络超时也不自动重试提交。
    writeFileSync(stateFile, JSON.stringify({ status: 'SUBMITTING', at: new Date().toISOString() }), { flag: 'wx' });
    const queued = assertOk(await api(`/run/${MODEL_ID}`, { method: 'POST', token, body }), '提交生成任务');
    save('submission.json', {
      run_id: queued.id,
      status: queued.status,
      operation: queued.operation,
      queue_position: queued.queue_position ?? null,
      credit_estimate: queued.credit_estimate ?? null,
      at: new Date().toISOString(),
    });
    console.log('已提交，任务 ID：' + queued.id + '；平台预估 credits=' + JSON.stringify(queued.credit_estimate ?? null));
    return;
  }

  const state = load('submission.json');
  if (!state.run_id) throw new Error('上次提交结果未知，请核对平台日志，不要重新提交。');
  for (let i = 0; i < 60; i++) {
    const run = assertOk(await api(`/runs/${encodeURIComponent(state.run_id)}`, { token }), '查询任务状态');
    save('result.json', run);
    const status = String(run.status).toLowerCase();
    console.log(`[${new Date().toISOString()}] 状态=${status} 进度=${run.progress ?? '-'}`);
    if (TERMINAL_OK.includes(status)) {
      const events = await api(`/runs/${encodeURIComponent(state.run_id)}/events`, { token });
      if (events.ok) save('events.json', events.json);
      save('credits.json', {
        run_id: state.run_id,
        credits: run.credits ?? null,
        estimate: load('request.json').estimate,
        note: 'credits.charged 为平台实扣 credits（1 credit = $0.01）；credits_charged 原始凭证见 events.json。',
        at: new Date().toISOString(),
      });
      const file = run.video ?? run.outputs?.map(o => o.file).find(Boolean) ?? null;
      if (!file?.url) throw new Error('任务完成但未返回视频链接，详见 result.json');
      let response = await fetch(file.url, { signal: AbortSignal.timeout(600000) });
      if ([401, 403].includes(response.status)) response = await fetch(file.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error('视频下载失败 HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('下载内容不是有效 MP4 容器');
      writeFileSync(outPath('protoface-ltx-s029.mp4'), bytes);
      save('artifact.json', {
        run_id: state.run_id,
        url_host: new URL(file.url).host,
        content_type: file.content_type ?? null,
        file_name: file.file_name ?? null,
        file_size: file.file_size ?? null,
        saved_bytes: bytes.length,
        sha256: sha256(bytes),
        created_at: run.created_at,
        started_at: run.started_at,
        completed_at: run.completed_at,
        generation_seconds: run.started_at && run.completed_at ? (new Date(run.completed_at) - new Date(run.started_at)) / 1000 : null,
        audio_untouched: '原样保存下载流，未静音、未裁剪、未改音轨',
      });
      console.log('视频已保存：' + outPath('protoface-ltx-s029.mp4') + '（' + bytes.length + ' 字节）');
      return;
    }
    if (TERMINAL_BAD.includes(status)) throw new Error('任务终止：' + status + '；详见 result.json，不自动重试。');
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log('仍在运行；重新执行 poll 继续查询，不会重复生成、不会重复扣费。');
}

main().catch(error => {
  console.error('操作未完成：' + redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
