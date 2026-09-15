import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { AssetArtifact } from '../../../../../../shared/src/index.js';
import type { AssetProviderAdapter } from '../../assets-provider-adapter.js';
import { resolveAssetsRunStorage, writeAssetFile } from '../../assets-file-storage.js';
import { probeVideoMetadata } from '../../../../http/video-probe.js';
export const AUTODL_VIDEO_MODEL = 'minimax_h3_lightx2v_v5';
interface Options {
    apiKey: string;
    model: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
}
interface Part {
    task_id: string;
    duration_sec: number;
    resolution: string;
    source_image_artifact_id: string;
    split_index: number;
    split_total: number;
    results?: Array<{
        type?: string;
        file_type?: string;
        url?: string;
    }>;
    status?: string;
}
const base = 'https://autodl.art/api/v1/comfyui';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
export function createAutodlImageToVideoProvider(options: Options): AssetProviderAdapter {
    if (options.model !== AUTODL_VIDEO_MODEL)
        throw new Error('autodl_model_unsupported');
    async function api(path: string, body?: unknown): Promise<any> {
        if (!options.apiKey.trim())
            throw new Error('autodl_credential_missing');
        try {
            const response = await fetch(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { Authorization: options.apiKey, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000) });
            if (!response.ok)
                throw new Error('http');
            const json = await response.json() as any;
            if (json.code !== 'Success' || !json.data)
                throw new Error('response');
            return json.data;
        }
        catch {
            throw new Error('autodl_request_failed');
        }
    }
    return {
        providerName: 'autodl_image_to_video', providerType: 'video',
        billing: { capability: 'video.image_to_video', providerKey: 'autodl', modelId: options.model },
        canHandle: ({ taskType }) => taskType === 'video_clip',
        async prepare(ctx) {
            const route = ctx.manifest.segment_routes.find(r => r.segment_id === ctx.planTask.source_segment_id);
            const image = [route?.primary_visual_artifact_id, route?.fallback_visual_artifact_id].map(id => ctx.manifest.artifacts.find(a => a.artifact_id === id && a.artifact_type === 'image')).find(Boolean);
            if (!image)
                throw new Error('autodl_source_image_missing');
            let uri = image.file_uri;
            if (!uri.startsWith('data:image/') && !uri.startsWith('https://')) {
                const mime = extname(uri).toLowerCase() === '.webp' ? 'image/webp' : /\.jpe?g$/i.test(uri) ? 'image/jpeg' : 'image/png';
                uri = `data:${mime};base64,${(await readFile(uri)).toString('base64')}`;
            }
            let duration = Number(ctx.planTask.parameters.duration_sec ?? 5);
            if (ctx.manifest.manifest_version === 'asset_manifest_v2') {
                const range = ctx.manifest.segment_routes.find(r => r.segment_id === ctx.planTask.source_segment_id)?.narrationRange;
                if (!range || !Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) || range.startMs < 0 || range.endMs <= range.startMs || range.endMs > ctx.manifest.narration_reference.duration_ms)
                    throw new Error('narration_manifest_range_invalid');
                duration = (range.endMs - range.startMs) / 1000;
            }
            else {
                const meta = ctx.manifest.artifacts.find(a => a.artifact_id === route?.tts_artifact_id)?.metadata as Record<string, unknown> | undefined;
                if (meta && typeof meta.duration_source === 'string' && meta.duration_source !== 'estimated' && typeof meta.duration_sec === 'number' && meta.duration_sec > 0)
                    duration = meta.duration_sec;
            }
            if (!Number.isFinite(duration) || duration <= 0)
                throw new Error('autodl_duration_invalid');
            const total = Math.ceil(Math.ceil(duration) / 10), seconds = Math.ceil(duration / total);
            const requested = String(ctx.planTask.parameters.resolution ?? '720P').toUpperCase();
            if (!['720P', '1080P'].includes(requested))
                throw new Error('autodl_resolution_unsupported');
            const resolution = requested === '1080P' ? '1080p竖' : '768p竖';
            return { providerJobId: null, rawRequestJson: { endpoint: base + '/comfyui_workflow/' + options.model, payload: { prompt: ctx.planTask.prompt_draft ?? ctx.planTask.source_excerpt, ref_image_0: uri, duration: seconds, resolution }, duration_sec: seconds, split_total: total, resolution: requested, source_image_artifact_id: image.artifact_id } };
        },
        async submit(ctx, prepared) {
            const raw = prepared.rawRequestJson;
            const parts: Part[] = [];
            const storage = resolveAssetsRunStorage({ projectStorageRootDir: ctx.projectStorageRootDir, runId: ctx.assetRunId });
            for (let i = 0; i < Number(raw.split_total); i++) {
                await ctx.beforeDispatch?.();
                await writeAssetFile({ storage, category: 'diagnostics', fileName: `autodl_${ctx.execution.execution_id}_${ctx.execution.attempts}.json`, data: JSON.stringify({ parts, submitting_index: i }) });
                ctx.onDispatch?.();
                const data = await api('/comfyui_workflow/' + options.model, raw.payload);
                if (typeof data.task_id !== 'string' || !data.task_id)
                    throw new Error('autodl_task_id_missing');
                parts.push({ task_id: data.task_id, duration_sec: Number(raw.duration_sec), resolution: String(raw.resolution), source_image_artifact_id: String(raw.source_image_artifact_id), split_index: i, split_total: Number(raw.split_total) });
                await writeAssetFile({ storage, category: 'diagnostics', fileName: `autodl_${ctx.execution.execution_id}_${ctx.execution.attempts}.json`, data: JSON.stringify({ parts }) });
            }
            return { providerJobId: parts[0].task_id, rawResponseJson: { parts } };
        },
        async poll(ctx, submitted) {
            const parts = structuredClone(submitted.rawResponseJson?.parts) as Part[];
            if (!Array.isArray(parts) || !parts.length)
                throw new Error('autodl_task_state_missing');
            for (let attempt = 0; attempt < (options.maxPollAttempts ?? 120); attempt++) {
                for (const part of parts) {
                    if (part.status === 'SUCCESS')
                        continue;
                    await ctx.beforeDispatch?.();
                    const data = await api('/comfyui_workflow/result/' + encodeURIComponent(part.task_id));
                    const status = String(data.status).toUpperCase();
                    if (['FAILED', 'CANCELED', 'CANCELLED', 'ERROR'].includes(status))
                        return { status: 'failed', rawResponseJson: { parts }, errorCode: 'autodl_generation_failed', errorMessage: 'AutoDL视频生成失败' };
                    if (!['SUCCESS', 'COMPLETED', 'RUNNING', 'QUEUED', 'PENDING'].includes(status))
                        throw new Error('autodl_status_unknown');
                    part.status = status === 'COMPLETED' ? 'SUCCESS' : status;
                    if (part.status === 'SUCCESS')
                        part.results = data.results;
                }
                if (parts.every(p => p.status === 'SUCCESS'))
                    return { status: 'completed', rawResponseJson: { parts } };
                if (attempt + 1 < (options.maxPollAttempts ?? 120))
                    await wait(options.pollIntervalMs ?? 10000);
            }
            return { status: 'running', rawResponseJson: { parts } };
        },
        async download(ctx, pollResult) {
            const parts = pollResult.rawResponseJson?.parts as unknown as Part[];
            if (!Array.isArray(parts) || !parts.length)
                throw new Error('autodl_results_missing');
            const artifacts: AssetArtifact[] = [];
            for (const part of parts) {
                const url = part.results?.find(r => r.type === 'video' || r.file_type === 'mp4')?.url;
                if (!url || new URL(url).protocol !== 'https:')
                    throw new Error('autodl_video_url_invalid');
                await ctx.beforeDispatch?.();
                const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
                if (!response.ok)
                    throw new Error('autodl_download_failed');
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp')
                    throw new Error('autodl_video_invalid');
                const suffix = part.split_total > 1 ? `_part${part.split_index + 1}` : '';
                const storage = resolveAssetsRunStorage({ projectStorageRootDir: ctx.projectStorageRootDir, runId: ctx.assetRunId });
                const written = await writeAssetFile({ storage, category: 'videos', fileName: `autodl_${ctx.execution.task_id}${suffix}.mp4`, data: buffer });
                const measured = await probeVideoMetadata(written.fileUri);
                artifacts.push({ artifact_id: `artifact_video_${ctx.execution.task_id}${suffix}_${Date.now().toString(36)}`, artifact_type: 'video', origin: 'provider', file_uri: written.fileUri, created_at: new Date().toISOString(), metadata: { ...measured, model: options.model, provider_name: 'autodl_image_to_video', provider_job_id: part.task_id, source_image_artifact_id: part.source_image_artifact_id, file_hash: written.fileHash, relative_path: written.relativePath, resolution: part.resolution, video_split_group_id: part.split_total > 1 ? `${ctx.assetRunId}:${ctx.execution.execution_id}:${ctx.execution.attempts}` : undefined, video_split_of_task: part.split_total > 1 ? ctx.planTask.task_id : undefined, video_split_index: part.split_index, video_split_total: part.split_total > 1 ? part.split_total : undefined } });
            }
            return artifacts;
        },
        normalizeResult: async ({ downloadedArtifacts }) => ({ artifacts: downloadedArtifacts, notes: ['AutoDL H3视频已生成，原音轨保留'] }),
        cancel: async () => undefined,
    };
}
