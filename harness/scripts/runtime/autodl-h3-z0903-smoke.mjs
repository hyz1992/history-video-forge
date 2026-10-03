import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// AutoDL minimax_h3_z0903（H3六图三音频生视频/高质量音画融合）独立试调。
// 沿用 autodl-video-smoke.mjs 的鉴权、单次提交保护、轮询与落盘约定；
// 只读业务库与 prompts/ 下的正式 prompt，不写业务数据库，不改正式链路。
const OUT = resolve('harness/scripts/runtime/output/autodl-h3-z0903-s029');
const PROMPT_FILE = resolve('prompts/asset/protoface-ltx-video-smoke.prompt.md');
const WORKFLOW = 'minimax_h3_z0903';
const BASE = 'https://autodl.art/api/v1/comfyui';
const TOKEN_ENV = 'AUTODL_COMFYUI_TOKEN';
const VIDEO_NAME = 'autodl-h3-z0903-s029.mp4';
const SOURCE = {
  assetRunId: 'assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9',
  taskId: 'video_029',
  projectDir: 'storage/projects/2026-08-05/装病十年的野心家，一朝发难尽诛曹氏 [p_e115c849]',
  originalVideoRelative: 'assets-runs/assets_run_a98c3500-22a0-49ea-bde1-1a3281bd0bd9/videos/dashscope_video_029.mp4',
};
// 该工作流规格（取自工作流弹窗 API 面板，非猜测）：duration 1-15 秒。
// 注意：resolution 的合法取值是**含画布尺寸的完整标签**，不是短名——
// 传 "768p竖" 会被平台以 "resolution 的值: 768p竖 不在 options 列表中" 拒绝；
// 实测 "768p竖(768*1376)" 才被接受。面板把标签写成 "768p竖(768*1376)" 容易误读为
// “短名 + 括号注释”，实际整串才是枚举值。
const INTENT = { duration: 10, resolution: '768p竖(768*1376)' };
// 官方标价：768p 高峰(08:00-24:00) ¥0.070/秒、空闲(00:00-08:00) ¥0.050/秒。
const PRICE_PEAK_PER_SECOND = 0.07;
const PRICE_OFFPEAK_PER_SECOND = 0.05;
const AUDIO_REF = 'ref-audio.mp3';
const TERMINAL_OK = ['SUCCESS', 'COMPLETED'];
const TERMINAL_BAD = ['FAILED', 'CANCELLED', 'CANCELED', 'ERROR'];

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
  const file = outPath('token.txt');
  const token = (process.env[TOKEN_ENV] ?? (existsSync(file) ? readFileSync(file, 'utf8') : '')).trim();
  if (!token || token.includes('请在此填写')) {
    throw new Error(`缺少可用令牌：请把 AutoDL ComfyUI 分组令牌写入 ${file}，或设置环境变量 ${TOKEN_ENV}。不要在聊天中粘贴令牌。`);
  }
  return token;
}

function redact(value, token) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (token) text = text.split(token).join('[已隐藏令牌]');
  return text.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:<已省略base64>');
}

async function api(path, { method = 'GET', body, token, timeoutMs = 120000 } = {}) {
  const response = await fetch(BASE + path, {
    method,
    redirect: 'error',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  if (!response.ok) throw new Error(`AutoDL HTTP ${response.status}：${redact(text.slice(0, 300), token)}`);
  if (json.code !== 'Success') throw new Error('AutoDL 返回非成功状态；错误码：' + redact(String(json.code), token));
  return json;
}

function hourlyPrice(hour = new Date().getHours()) {
  const peak = hour >= 8 && hour < 24;
  return { peak, perSecond: peak ? PRICE_PEAK_PER_SECOND : PRICE_OFFPEAK_PER_SECOND, label: peak ? '高峰(08:00-24:00)' : '空闲(00:00-08:00)' };
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
    const AUDIO_LINE_PREFIX = '【音频约束】';
    const withoutAudio = body.split('\n').filter(l => !l.startsWith(AUDIO_LINE_PREFIX)).join('\n').trim();
    if (withoutAudio !== original.payload.input.prompt.trim()) {
      throw new Error('正式 prompt 去掉音频约束后与原分镜提示词不一致，停止准备');
    }
    writeFileSync(outPath('prompt.txt'), body + '\n');

    const audio = outPath(AUDIO_REF);
    if (!existsSync(audio)) throw new Error(`缺少参考音频 ${audio}：该工作流 ref_audio_0 为必填。`);
    const audioBytes = readFileSync(audio);
    const originalVideo = resolve(SOURCE.projectDir, SOURCE.originalVideoRelative);

    save('intent.json', { workflow: WORKFLOW, ...INTENT, note: 'duration/resolution 取自工作流弹窗 API 面板的枚举，非猜测' });
    save('source.json', {
      provider_job_record_id: row.id,
      asset_run_id: SOURCE.assetRunId,
      task_id: SOURCE.taskId,
      original_video: originalVideo,
      original_video_exists: existsSync(originalVideo),
      prompt_file: PROMPT_FILE,
      prompt_unchanged_except_audio_line: true,
      image_sha256: sha256(bytes),
      image_bytes: bytes.length,
      ref_audio_file: AUDIO_REF,
      ref_audio_sha256: sha256(audioBytes),
      ref_audio_bytes: statSync(audio).size,
      ref_audio_provenance: '从上一轮 Protoface LTX 2.5 Fast 付费成片抽取的环境音轨；该成片经 ASR + 频谱核验未检出人声，与本分镜同场景同 10 秒。',
      ref_audio_voice_free_evidence: 'harness/scripts/runtime/output/protoface-ltx-s029/asr-paid-ltx.json（no_valid_speech_fragment）与 frames/spec-paid-zoom.png（均匀宽带噪声，无谐波堆叠）',
    });
    console.log('准备完成：原提示词（仅追加音频约束）、原参考图字节、无人声环境音轨已就位；未调用付费接口。');
    console.log(`参考图 ${bytes.length} 字节；参考音频 ${statSync(audio).size} 字节`);
    return;
  }

  const token = readToken();

  if (!['submit', 'poll'].includes(mode)) {
    throw new Error('用法：node harness/scripts/runtime/autodl-h3-z0903-smoke.mjs prepare|submit|poll');
  }

  const stateFile = outPath('submission.json');
  if (mode === 'submit') {
    if (existsSync(stateFile)) throw new Error('已有提交记录，请使用 poll；未知提交结果不能自动重发。');
    const intent = load('intent.json');
    const dataUri = (file, mime) => `data:${mime};base64,` + readFileSync(outPath(file)).toString('base64');
    const body = {
      prompt: readFileSync(outPath('prompt.txt'), 'utf8').trim(),
      duration: intent.duration,
      resolution: intent.resolution,
      ref_image_0: dataUri('reference.png', 'image/png'),
      ref_audio_0: dataUri(AUDIO_REF, 'audio/mpeg'),
    };
    const price = hourlyPrice();
    const cost = intent.duration * price.perSecond;
    save('request.json', {
      workflow: WORKFLOW,
      endpoint: `POST ${BASE}/comfyui_workflow/${WORKFLOW}`,
      body_redacted: { ...body, ref_image_0: redact(body.ref_image_0, token), ref_audio_0: redact(body.ref_audio_0, token) },
      spec_source: '工作流弹窗 API 面板枚举',
      price: { ...price, seconds: intent.duration, total_cny: cost },
      estimate_note: '按 AutoDL 公开标价估算，实际以平台账单为准',
      approved: approve,
      at: new Date().toISOString(),
    });
    console.log('=== 本次实际输入 ===');
    console.log('工作流：' + WORKFLOW + '（H3六图三音频生视频/高质量音画融合）');
    console.log('提示词：' + body.prompt);
    console.log('时长：' + intent.duration + ' 秒；分辨率：' + intent.resolution);
    console.log('参考图：ref_image_0 = reference.png（' + statSync(outPath('reference.png')).size + ' 字节）');
    console.log('参考音频：ref_audio_0 = ' + AUDIO_REF + '（' + statSync(outPath(AUDIO_REF)).size + ' 字节，无人声环境音轨）');
    console.log('=== 预计费用 ===');
    console.log(`${price.label} ¥${price.perSecond}/秒 × ${intent.duration} 秒 = ￥${cost.toFixed(2)}；估算，实际以平台账单为准。`);
    if (!approve) {
      console.log('未传 --approve：仅展示，不提交。');
      return;
    }
    // 写入意向后只发一次；网络超时也不自动重试提交。
    writeFileSync(stateFile, JSON.stringify({ status: 'SUBMITTING', at: new Date().toISOString() }), { flag: 'wx' });
    const queued = await api(`/comfyui_workflow/${WORKFLOW}`, { method: 'POST', token, body });
    if (!queued.data?.task_id) throw new Error('响应缺少 task_id；请先核对平台调用日志');
    save('submission.json', { task_id: queued.data.task_id, workflow: queued.data.workflow, status: queued.data.status, at: new Date().toISOString() });
    console.log('已提交，任务 ID：' + queued.data.task_id + '，状态 ' + queued.data.status);
    return;
  }

  const state = load('submission.json');
  if (!state.task_id) throw new Error('上次提交结果未知，请核对平台日志，不要重新提交。');
  for (let i = 0; i < 60; i++) {
    const result = await api('/comfyui_workflow/result/' + encodeURIComponent(state.task_id), { token });
    save('result.json', result);
    const status = String(result.data?.status ?? '').toUpperCase();
    console.log(`[${new Date().toISOString()}] 状态=${status} 平台耗时=${result.data?.duration ?? '-'}秒`);
    if (TERMINAL_OK.includes(status)) {
      const video = (result.data.results ?? []).find(x => x.type === 'video' || x.file_type === 'mp4');
      if (!video?.url || new URL(video.url).protocol !== 'https:') throw new Error('缺少有效视频链接，详见 result.json');
      // 资源下载不携带平台鉴权头。
      const response = await fetch(video.url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error('视频下载失败 HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('下载内容不是有效 MP4 容器');
      writeFileSync(outPath(VIDEO_NAME), bytes);
      save('artifact.json', {
        task_id: state.task_id,
        url_host: new URL(video.url).host,
        file_type: video.file_type ?? null,
        saved_bytes: bytes.length,
        sha256: sha256(bytes),
        platform_duration_seconds: result.data.duration ?? null,
        audio_untouched: '原样保存下载流，未静音、未裁剪、未改音轨',
      });
      console.log('视频已保存：' + outPath(VIDEO_NAME) + '（' + bytes.length + ' 字节）');
      console.log('平台自报耗时：' + (result.data.duration ?? '未知') + ' 秒');
      return;
    }
    if (TERMINAL_BAD.includes(status)) throw new Error('任务终止：' + status + '；详见 result.json，不自动重试。');
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('仍在运行；重新执行 poll 继续查询，不会重复生成、不会重复扣费。');
}

main().catch(error => {
  console.error('操作未完成：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
