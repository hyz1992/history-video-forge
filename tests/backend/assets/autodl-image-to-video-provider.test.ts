import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dirs: string[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), 'autodl-test-')); dirs.push(p); return p; }
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutodlImageToVideoProvider } from '../../../backend/src/modules/assets/providers/autodl/autodl-image-to-video-provider.js';
import type { AssetProviderContext } from '../../../backend/src/modules/assets/assets-provider-adapter.js';
const ctx = (duration = 5) => ({ manifest: { manifest_version: 'asset_manifest_v2', narration_reference: { duration_ms: 60000 }, segment_routes: [{ segment_id: 's1', primary_visual_artifact_id: 'img', narrationRange: { startMs: 0, endMs: duration * 1000 } }], artifacts: [{ artifact_id: 'img', artifact_type: 'image', file_uri: 'data:image/png;base64,aGVsbG8=' }] }, planTask: { source_segment_id: 's1', prompt_draft: '古代宫殿', parameters: { resolution: '720P' }, task_id: 'v1' }, execution: { task_id: 'v1', execution_id: 'e1', attempts: 1 }, assetRunId: 'run1', projectStorageRootDir: temp() }) as unknown as AssetProviderContext;
afterEach(() => { vi.unstubAllGlobals(); for (const p of dirs.splice(0))
    rmSync(p, { recursive: true, force: true }); });
describe('AutoDL视频协议', () => {
    it('原图提示词、768P映射和真实时间轴分片', async () => {
        const p = await createAutodlImageToVideoProvider({ apiKey: 'secret', model: 'minimax_h3_lightx2v_v5' }).prepare(ctx(23));
        const r = p.rawRequestJson as any;
        expect(r.payload).toMatchObject({ prompt: '古代宫殿', ref_image_0: 'data:image/png;base64,aGVsbG8=', resolution: '768p竖', duration: 8 });
        expect(r.split_total).toBe(3);
        expect(JSON.stringify(r)).not.toContain('secret');
    });
    it('拒绝缺失口播范围', async () => { const c = ctx(); delete (c.manifest.segment_routes[0] as any).narrationRange; await expect(createAutodlImageToVideoProvider({ apiKey: 's', model: 'minimax_h3_lightx2v_v5' }).prepare(c)).rejects.toThrow('narration'); });
    it('分片任务ID可跨适配器恢复，鉴权不加Bearer', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'Success', data: { task_id: 't1' } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'Success', data: { task_id: 't2' } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'Success', data: { status: 'SUCCESS', results: [{ type: 'video', url: 'https://example.com/v.mp4' }] } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'Success', data: { status: 'SUCCESS', results: [{ type: 'video', url: 'https://example.com/v2.mp4' }] } })));
        vi.stubGlobal('fetch', fetchMock);
        const a = createAutodlImageToVideoProvider({ apiKey: 'secret', model: 'minimax_h3_lightx2v_v5', pollIntervalMs: 0 });
        const c = ctx(11);
        const sub = await a.submit(c, await a.prepare(c));
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('secret');
        const b = createAutodlImageToVideoProvider({ apiKey: 'secret', model: 'minimax_h3_lightx2v_v5', pollIntervalMs: 0 });
        expect((await b.poll(c, JSON.parse(JSON.stringify(sub)))).status).toBe('completed');
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    it('提交网络异常不自动重发、不泄漏令牌', async () => { const f = vi.fn().mockRejectedValue(new Error('secret')); vi.stubGlobal('fetch', f); const a = createAutodlImageToVideoProvider({ apiKey: 'secret', model: 'minimax_h3_lightx2v_v5' }); await expect(a.submit(ctx(), await a.prepare(ctx()))).rejects.toThrow('autodl'); expect(f).toHaveBeenCalledTimes(1); });
});
vi.mock('../../../backend/src/http/video-probe.js', () => ({ probeVideoMetadata: vi.fn(async () => ({ duration_sec: 5.166667, width: 768, height: 1344, fps: 24 })) }));
it.each(['FAILED', 'CANCELED', 'CANCELLED'])('失败状态%s停止轮询', async (status) => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'Success', data: { status } })));
    vi.stubGlobal('fetch', f);
    const a = createAutodlImageToVideoProvider({ apiKey: 's', model: 'minimax_h3_lightx2v_v5', pollIntervalMs: 0 });
    expect((await a.poll(ctx(), { providerJobId: 't', rawResponseJson: { parts: [{ task_id: 't' }] } })).status).toBe('failed');
    expect(f).toHaveBeenCalledTimes(1);
});
it('轮询达上限保留任务状态，不重新提交', async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 'Success', data: { status: 'RUNNING' } })));
    vi.stubGlobal('fetch', f);
    const a = createAutodlImageToVideoProvider({ apiKey: 's', model: 'minimax_h3_lightx2v_v5', pollIntervalMs: 0, maxPollAttempts: 2 });
    const result = await a.poll(ctx(), { providerJobId: 't', rawResponseJson: { parts: [{ task_id: 't' }] } });
    expect(result.status).toBe('running');
    expect(result.rawResponseJson?.parts).toEqual([{ task_id: 't', status: 'RUNNING' }]);
    expect(f).toHaveBeenCalledTimes(2);
});
it('分片下载独立文件，探测真实时长，下载不带令牌', async () => {
    const f = vi.fn().mockImplementation(async () => new Response(Buffer.from('0000ftyp00000000')));
    vi.stubGlobal('fetch', f);
    const a = createAutodlImageToVideoProvider({ apiKey: 'secret', model: 'minimax_h3_lightx2v_v5' });
    const artifacts = await a.download(ctx(), { status: 'completed', rawResponseJson: { parts: [0, 1].map(i => ({ task_id: 't' + i, duration_sec: 5, resolution: '720P', split_index: i, split_total: 2, source_image_artifact_id: 'img', results: [{ type: 'video', url: 'https://example.com/' + i + '.mp4' }] })) } });
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].file_uri).not.toBe(artifacts[1].file_uri);
    expect(artifacts[0].metadata).toMatchObject({ duration_sec: 5.166667, width: 768, height: 1344, video_split_total: 2, provider_name: 'autodl_image_to_video' });
    expect(f.mock.calls.every(c => !c[1].headers)).toBe(true);
});
