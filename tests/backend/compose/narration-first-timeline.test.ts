import { describe, expect, it } from 'vitest';
import { runnable } from '../narration/subtitle-revision-test-context.js';
import { importNarrationManifest } from '../../../backend/src/modules/assets/narration-manifest-importer.js';
import { buildComposeTimeline } from '../../../backend/src/modules/compose/compose-timeline-builder.js';
import { buildRemotionInputProps } from '../../../backend/src/modules/render/remotion-input-builder.js';
import { AssetManifestV2 } from '../../../shared/src/index.js';
import { writeFile } from 'node:fs/promises';
async function fixture() { const f = await runnable(); const manifest = await importNarrationManifest(f); const template = manifest.segment_routes[0]!; manifest.segment_routes = Array.from({ length: 22 }, (_, i) => ({ ...template, segment_id: 's' + i, narrationRange: { startMs: Math.round(i * 117000 / 22), endMs: Math.round((i + 1) * 117000 / 22) } })); return { ...f, manifest }; }
function build(f: Awaited<ReturnType<typeof fixture>>) { return buildComposeTimeline({ manifest: f.manifest, assetManifestRecordId: 'm', assetPlanRecordId: 'ap', storyboardRecordId: 'sb', scriptRecordId: 's1', projectStorageRootDir: f.path }); }
describe('narration first timeline', () => {
    it('22 ranges consume full WAV duration with separate outro', async () => { const f = await fixture(), before = structuredClone(f.manifest), t = build(f); expect(t.timeline_version).toBe('compose_timeline_v2'); expect(t).toMatchObject({ contentDurationMs: 117000, outroDurationMs: 3000, duration_sec: 120 }); expect(t.segments.map(s => [s.start_sec, s.duration_sec])).toEqual(f.manifest.segment_routes.map(r => [r.narrationRange.startMs / 1000, (r.narrationRange.endMs - r.narrationRange.startMs) / 1000])); expect(t.tracks.find(t => t.track_type === 'narration')?.clips).toHaveLength(1); expect(t.tracks.find(t => t.track_type === 'narration')?.clips[0]).toMatchObject({ start_sec: 0, duration_sec: 117 }); expect(f.manifest).toEqual(before); });
    it('passes native cues with silence unchanged through real render builder', async () => { const f = await fixture(), t = build(f), s = f.manifest.artifacts.find(a => a.artifact_type === 'subtitle_track')!; await writeFile(s.file_uri.replace('file://', ''), '1\n00:00:01,000 --> 00:00:02,000\n甲\n\n2\n00:01:54,000 --> 00:01:55,000\n乙\n'); const props = await buildRemotionInputProps({ timeline: t, manifest: f.manifest, assetBaseDir: f.path, projectStorageRootDir: f.path, width: 1080, height: 1920, fps: 30 }); expect(props.subtitleCues).toEqual([{ start_sec: 1, end_sec: 2, text: '甲' }, { start_sec: 114, end_sec: 115, text: '乙' }]); expect(props.subtitleStyle).toEqual(s.metadata.subtitle_style); expect(props.audioClips?.filter(c => c.role === 'narration')).toHaveLength(1); });
    it('rejects missing native source instead of falling back', async () => { const f = await fixture(); delete (f.manifest as any).narration_reference; expect(() => build(f)).toThrow(); });
    it('rejects broken frozen subtitle style and provenance', async () => { const f = await fixture(), t = build(f); for (const mutation of [(m: any) => delete m.artifacts.find((a: any) => a.artifact_type === 'subtitle_track').metadata.subtitle_style, (m: any) => m.subtitle_settings_hash = 'f'.repeat(64)]) {
        const m = structuredClone(f.manifest);
        mutation(m);
        await expect(buildRemotionInputProps({ timeline: t, manifest: m, assetBaseDir: f.path, width: 1080, height: 1920, fps: 30 })).rejects.toThrow();
    } });
});

import { projectNarrationFrameRange } from '../../../shared/src/narration/timeline-frame-projection.js';
for(const split of [false,true])it('片尾冻结实际已显示视频帧 split='+split,async()=>{
 const f=await fixture(),last=f.manifest.segment_routes.at(-1)!;
 const video={artifact_id:'last-video',artifact_type:'video' as const,origin:'local' as const,file_uri:'https://example.invalid/video.mp4',created_at:new Date().toISOString(),metadata:{duration_sec:20,width:1080,height:1920,fps:30,...(split?{video_split_of_task:'v',video_split_total:2,video_split_index:0}:{})}};
 f.manifest.artifacts.push(video);last.visual_route_type='video_clip';last.primary_visual_artifact_id=video.artifact_id;last.motion_artifact_id=null;
 if(split){video.metadata.duration_sec=2;f.manifest.artifacts.push({...video,artifact_id:'split-last',metadata:{...video.metadata,duration_sec:20,video_split_index:1}});}
 const t=build(f),props=await buildRemotionInputProps({timeline:t,manifest:f.manifest,assetBaseDir:f.path,width:1080,height:1920,fps:30});const clips=props.visualClips!,outro=clips.at(-1)!,previous=clips.at(-2)!;
 const range=projectNarrationFrameRange({startMs:previous.startMs!,endMs:previous.endMs!,fps:30});expect(outro.freezeAtSec).toBe((range.durationInFrames-1)/30);expect(outro.artifactId).toBe(previous.artifactId);
});
it('动效图片片尾保持最后变换进度',async()=>{
 const f=await fixture(),last=f.manifest.segment_routes.at(-1)!;f.manifest.artifacts.push({artifact_id:'last-image',artifact_type:'image',origin:'local',file_uri:'https://example.invalid/image.png',created_at:new Date().toISOString(),metadata:{width:1080,height:1920}},{artifact_id:'motion',artifact_type:'motion_recipe',origin:'inline',file_uri:'inline://motion',created_at:new Date().toISOString(),metadata:{recipe_type:'push_in',source_image_artifact_id:'last-image',parameters:{}}});last.primary_visual_artifact_id='last-image';last.motion_artifact_id='motion';last.visual_route_type='image_with_motion';
 const t=build(f),props=await buildRemotionInputProps({timeline:t,manifest:f.manifest,assetBaseDir:f.path,width:1080,height:1920,fps:30}),previous=props.visualClips!.at(-2)!,outro=props.visualClips!.at(-1)!;const range=projectNarrationFrameRange({startMs:previous.startMs!,endMs:previous.endMs!,fps:30});expect(outro.frozenMotionProgress).toBe((range.durationInFrames-1)/30/previous.durationSec);
});

it('预设与项目偏好更新后历史字幕仍消费冻结快照',async()=>{
 const {SUBTITLE_STYLE_PRESET_REGISTRY_V1}=await import('../../../shared/src/index.js');const f=await fixture(),t=build(f),subtitle=f.manifest.artifacts.find(a=>a.artifact_type==='subtitle_track')!,frozen=structuredClone(subtitle.metadata.subtitle_style),preset=SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!,version=preset.preset_version;
 try{preset.preset_version='999';const config=[...f.db.projectGenerationConfigurations.values()][0]!;config.configurationJson.creative.subtitle_style_preset_id=preset.preset_id;config.configurationJson.creative.subtitle_style_overrides={font_size_px:80};const props=await buildRemotionInputProps({timeline:t,manifest:f.manifest,assetBaseDir:f.path,width:1080,height:1920,fps:30});expect(props.subtitleStyle).toEqual(frozen);}finally{preset.preset_version=version;}
});
