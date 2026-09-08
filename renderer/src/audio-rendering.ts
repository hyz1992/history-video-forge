import { projectNarrationFrameRange } from "../../shared/src/narration/timeline-frame-projection";
export function getAudioSequenceFrames(input: {
  startSec: number;
  durationSec: number;
  fps: number;
  startMs?: number;
  endMs?: number;
}) {
  if(input.startMs!==undefined||input.endMs!==undefined)return projectNarrationFrameRange({startMs:input.startMs!,endMs:input.endMs!,fps:input.fps});
  return {
    from: Math.max(0, Math.round(input.startSec * input.fps)),
    durationInFrames: Math.max(1, Math.round(input.durationSec * input.fps)),
  };
}

export function normalizeAudioVolume(volume: number) {
  return Math.min(1, Math.max(0, volume));
}

export function getFadedAudioVolume(input: {
  baseVolume: number;
  localSec: number;
  durationSec: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}) {
  const base = normalizeAudioVolume(input.baseVolume);
  const fadeIn = Math.max(0, input.fadeInSec ?? 0);
  const fadeOut = Math.max(0, input.fadeOutSec ?? 0);
  const inFactor =
    fadeIn > 0 ? Math.min(1, Math.max(0, input.localSec / fadeIn)) : 1;
  const remainingSec = input.durationSec - input.localSec;
  const outFactor =
    fadeOut > 0 ? Math.min(1, Math.max(0, remainingSec / fadeOut)) : 1;

  return base * Math.min(inFactor, outFactor);
}

export function getAudioLoopSequences(input: {
  clipDurationSec: number;
  sourceDurationSec?: number;
}) {
  const clipDurationSec = Math.max(0, input.clipDurationSec);
  const sourceDurationSec =
    input.sourceDurationSec && input.sourceDurationSec > 0
      ? input.sourceDurationSec
      : clipDurationSec;
  const sequences: Array<{ offsetSec: number; durationSec: number }> = [];

  if (clipDurationSec <= 0 || sourceDurationSec <= 0) {
    return sequences;
  }

  for (
    let offsetSec = 0;
    offsetSec < clipDurationSec;
    offsetSec += sourceDurationSec
  ) {
    const durationSec = Math.min(sourceDurationSec, clipDurationSec - offsetSec);
    if (durationSec > 0) {
      sequences.push({ offsetSec, durationSec });
    }
  }

  return sequences;
}

/** 内部循环只保留可见帧；零帧尾余量不改变外层音轨覆盖。 */
export function getAudioLoopSequenceFrames(input:{startMs:number;endMs:number;sourceDurationSec?:number;fps:number}){
 const outer=projectNarrationFrameRange(input),durationMs=input.endMs-input.startMs;
 const step=input.sourceDurationSec===undefined?durationMs:Math.round(input.sourceDurationSec*1000);
 if(!Number.isSafeInteger(step)||step<=0)throw new Error('narration_audio_loop_source_invalid');
 const loops:Array<{from:number;durationInFrames:number}>=[];
 for(let offset=0;offset<durationMs;offset+=step){const startMs=input.startMs+offset,endMs=Math.min(input.endMs,startMs+step);if(Math.round(startMs*input.fps/1000)===Math.round(endMs*input.fps/1000))continue;const range=projectNarrationFrameRange({startMs,endMs,fps:input.fps});loops.push({from:range.from-outer.from,durationInFrames:range.durationInFrames});}
 return loops;
}
