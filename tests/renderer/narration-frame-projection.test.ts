import { describe, expect, it } from 'vitest';
import { getVisualSequenceFrames, getVisibleVisualLayers } from '../../renderer/src/visual-rendering';
import { getAudioLoopSequenceFrames, getAudioSequenceFrames } from '../../renderer/src/audio-rendering';
import { projectNarrationFrameRange } from '../../shared/src/narration/timeline-frame-projection';
describe('narration absolute frame consumers', () => {
    for (const fps of [24, 25, 30])
        it('continuous absolute endpoints at ' + fps, () => {
            let cursor = 0;
            for (let i = 0; i < 220; i++) {
                const startMs = i * 533, endMs = (i + 1) * 533;
                const expected = projectNarrationFrameRange({ startMs, endMs, fps });
                for (const project of [getVisualSequenceFrames, getAudioSequenceFrames])
                    expect(project({ startSec: startMs / 1000, durationSec: (endMs - startMs) / 1000, startMs, endMs, fps })).toEqual(expected);
                expect(expected.from).toBe(cursor);
                cursor += expected.durationInFrames;
            }
            expect(Math.abs(cursor / fps - 117.26)).toBeLessThanOrEqual(1 / fps);
        });
    it('rejects zero frame intervals in real audio and visual consumers', () => {
        for (const project of [getVisualSequenceFrames, getAudioSequenceFrames])
            expect(() => project({ startSec: 0, durationSec: .001, startMs: 0, endMs: 1, fps: 30 })).toThrow('narration_zero_frame_interval');
    });
    it('image visibility uses the same rounded frame boundary', () => {
        const clips = [{ clipId: 'a', artifactId: 'a', mediaType: 'image' as const, src: 'a', startSec: 0, durationSec: .533, startMs: 0, endMs: 533 }, { clipId: 'b', artifactId: 'b', mediaType: 'image' as const, src: 'b', startSec: .533, durationSec: .533, startMs: 533, endMs: 1066 }];
        expect(getVisibleVisualLayers({ clips, frame: 16, fps: 30 }).map(l => l.clip.clipId)).toEqual(['b']);
    });
});

describe('音频内部循环保留绝对帧覆盖',()=>{
 for(const startMs of [0,533])for(const remainder of [1,34])it('起点'+startMs+'尾余量'+remainder,()=>{
  const endMs=startMs+120000+remainder,fps=30,outer=projectNarrationFrameRange({startMs,endMs,fps});
  const loops=getAudioLoopSequenceFrames({startMs,endMs,sourceDurationSec:10,fps});let end=0;
  for(const loop of loops){expect(loop.from).toBe(end);expect(loop.durationInFrames).toBeGreaterThan(0);end=loop.from+loop.durationInFrames;}expect(end).toBe(outer.durationInFrames);
 });
});
