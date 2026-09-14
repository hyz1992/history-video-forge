import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// 独立试调；只读已有运行记录，不写业务数据库。
const out = resolve('harness/scripts/runtime/output/autodl-s005');
const workflow = 'minimax_h3_lightx2v_v5';
const base = 'https://autodl.art/api/v1/comfyui';
const mode = process.argv[2] ?? 'prepare';
const save = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2));
const load = name => JSON.parse(readFileSync(resolve(out, name), 'utf8'));
mkdirSync(out, { recursive: true });

async function main() {
  if (mode === 'prepare') {
    const db = new DatabaseSync(resolve('storage/history-video-forge.db'), { readOnly: true });
    const row = db.prepare('SELECT id, rawRequestJson FROM AssetProviderJobRecord WHERE assetRunId=? AND taskId=?').get('9595720c-5a95-4593-a654-ffd5002a4984', 'video_s005_01');
    db.close();
    if (!row) throw new Error('未找到原视频请求');
    const original = JSON.parse(row.rawRequestJson);
    const image = original.payload.input.media[0].url;
    if (!image.startsWith('data:image/png;base64,')) throw new Error('参考图格式不符');
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    const body = { prompt: original.payload.input.prompt, ref_image_0: image, duration: 5, resolution: '768p竖' };
    writeFileSync(resolve(out, 'reference.png'), bytes);
    save('request.json', body);
    save('source.json', { provider_job_id: row.id, asset_run_id: '9595720c-5a95-4593-a654-ffd5002a4984', task_id: 'video_s005_01', original_model: original.payload.model, original_parameters: original.payload.parameters, workflow, duration: body.duration, resolution: body.resolution, image_sha256: createHash('sha256').update(bytes).digest('hex'), prompt_unchanged: true, image_unchanged: true, comparison_limits: '原模型首帧模式且 prompt_extend=true；H3 使用单张参考图，768x1344 与原720P并非完全相同比例。' });
    console.log('准备完成：原提示词、原图字节、5秒视频；尚未调用付费接口。');
    return;
  }
  if (!['submit', 'poll'].includes(mode)) throw new Error('用法：node harness/scripts/runtime/autodl-video-smoke.mjs prepare|submit|poll');
  const tokenFile = resolve(out, 'token.txt');
  const token = (process.env.AUTODL_COMFYUI_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '')).trim();
  if (!token || token.includes('请在此填写')) throw new Error('请在输出目录 token.txt 中填写 ComfyUI 分组令牌；不要发到聊天中。');
  async function api(path, body) {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { Authorization: token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error('AutoDL HTTP ' + r.status);
    const j = await r.json();
    if (j.code !== 'Success') throw new Error('AutoDL 返回非成功状态；错误码：' + String(j.code).replaceAll(token, '[已隐藏]'));
    return j;
  }
  const stateFile = resolve(out, 'submission.json');
  if (mode === 'submit') {
    if (existsSync(stateFile)) throw new Error('已有提交记录，请使用 poll；未知提交结果不能自动重发。');
    const body = load('request.json');
    const source = load('source.json');
    if (body.duration !== 5 || body.resolution !== '768p竖' || !body.prompt || createHash('sha256').update(Buffer.from(body.ref_image_0.split(',')[1], 'base64')).digest('hex') !== source.image_sha256) throw new Error('请求与已核对样本不一致');
    // 写入意向后只发一次；网络超时也不自动重试提交。
    writeFileSync(stateFile, JSON.stringify({ status: 'SUBMITTING', at: new Date().toISOString() }), { flag: 'wx' });
    const response = await api('/comfyui_workflow/' + workflow, body);
    if (!response.data?.task_id) throw new Error('响应缺少任务ID；请先核对平台调用日志');
    save('submission.json', { task_id: response.data.task_id, status: response.data.status, at: new Date().toISOString() });
  }
  const state = load('submission.json');
  if (!state.task_id) throw new Error('上次提交结果未知，请核对平台日志，不要重新提交。');
  for (let i = 0; i < 6; i++) {
    const result = await api('/comfyui_workflow/result/' + encodeURIComponent(state.task_id));
    save('result.json', result);
    const status = String(result.data?.status).toUpperCase();
    console.log('任务状态：' + status);
    if (['SUCCESS', 'COMPLETED'].includes(status)) {
      const video = result.data.results?.find(x => x.type === 'video' || x.file_type === 'mp4');
      if (!video?.url || new URL(video.url).protocol !== 'https:') throw new Error('缺少有效视频链接');
      // 资源下载不携带平台鉴权头。
      const r = await fetch(video.url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('视频下载失败 HTTP ' + r.status);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('下载内容不是有效MP4容器');
      writeFileSync(resolve(out, 'autodl-s005.mp4'), bytes);
      console.log('视频已保存，字节数：' + bytes.length);
      return;
    }
    if (['FAILED', 'CANCELLED', 'CANCELED', 'ERROR'].includes(status)) throw new Error('任务终止，详见本地 result.json；不自动重试。');
    if (!['QUEUED', 'RUNNING', 'PENDING'].includes(status)) throw new Error('未知状态，停止轮询并保留结果');
    if (i < 5) await new Promise(r => setTimeout(r, 8000));
  }
  console.log('仍在运行；执行 poll 继续查询，不会重复生成。');
}
main().catch(() => { console.error('操作未完成。请检查令牌、submission.json 与 result.json；为保护凭据，不打印请求或底层异常。'); process.exitCode = 1; });
