import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NarrationTimingMapV1, NarrationSubtitleSettingsSnapshot, NarrationSubtitleTimelineV1,
  canonicalStringify, hashNarrationSubtitleSettings, type NarrationSubtitleCue } from '../../../../shared/src/index.js';
import { buildSrtFromCaptions, buildVttFromCaptions, closeCaptionGaps } from '../assets/assets-subtitle-generator.js';

export const NARRATION_SUBTITLE_BUILDER_VERSION = 'narration-subtitles/v1';
const Input = z.object({timingMap:NarrationTimingMapV1,settingsSnapshot:NarrationSubtitleSettingsSnapshot}).strict();
const segmenter = new Intl.Segmenter('zh-CN', {granularity:'grapheme'});
const length = (text:string) => [...segmenter.segment(text)].length;
const display = (text:string) => text.replace(/\s+/gu,' ').trim();
const sentenceEnd = /[。！？；!?;](?:[”’」』）)\]\s]*)$/u;

/** 仅在合法source span之间换行/分cue，绝不从字数推算speech时间。 */
export async function buildNarrationSubtitles(value: unknown) {
  const parsed=Input.safeParse(value);
  if(!parsed.success)throw new Error('narration_subtitle_input_invalid');
  const {timingMap:map,settingsSnapshot}=parsed.data;
  const limit=settingsSnapshot.lineBreak.maxCharactersPerLine,maxLines=settingsSnapshot.resolvedStyle.max_lines;
  const cues:NarrationSubtitleCue[]=[];
  let first=0, lines:string[]=[], line='', pendingSpace=false;
  const flush=(last:number)=>{
    if(line)lines.push(line);
    const sourceStart=first===0?0:map.sourceSpans[first]!.sourceStart;
    const sourceEnd=map.sourceSpans[last+1]?.sourceStart??map.sourceText.length;
    const text=lines.join('\n');
    if(!text)throw new Error('narration_subtitle_empty_cue');
    const speechStartMs=map.sourceSpans[first]!.startMs,speechEndMs=map.sourceSpans[last]!.endMs;
    cues.push({id:`cue:${cues.length}`,text,sourceStart,sourceEnd,speechStartMs,speechEndMs,displayStartMs:speechStartMs,displayEndMs:speechEndMs});
    first=last+1;lines=[];line='';pendingSpace=false;
  };
  for(let i=0;i<map.sourceSpans.length;i++){
    const span=map.sourceSpans[i]!, sourceStart=i===0?0:span.sourceStart;
    const raw=map.sourceText.slice(sourceStart,map.sourceSpans[i+1]?.sourceStart??map.sourceText.length);
    const unit=display(raw);
    if(length(unit)>limit)throw new Error('narration_subtitle_unsplittable_span');
    // 空白仅在显示层归一化；来源范围始终覆盖完整原文。
    const separator=line && (pendingSpace||/^\s/u.test(raw))?' ':'';
    if(line && length(line+separator+unit)>limit){
      if(lines.length+1>=maxLines)flush(i-1);
      else {lines.push(line);line='';}
    }
    line+=line&&unit?separator+unit:unit;
    pendingSpace=/\s$/u.test(raw);
    if((line||lines.length)&&(sentenceEnd.test(raw)||/[\r\n]/u.test(raw)||i===map.sourceSpans.length-1))flush(i);
  }
  const captions=closeCaptionGaps(cues.map((cue,index)=>({index:index+1,start_sec:cue.speechStartMs/1000,end_sec:cue.speechEndMs/1000,text:cue.text,segment_ids:[]})));
  captions.forEach((caption,index)=>{cues[index]!.displayEndMs=Math.min(map.durationMs,Math.round(caption.end_sec*1000));});
  const timingHash=createHash('sha256').update(canonicalStringify(map)).digest('hex');
  const timeline=NarrationSubtitleTimelineV1.parse({schemaVersion:'narration_subtitle_timeline_v1',audioHash:map.audioHash,timingHash,durationMs:map.durationMs,cues});
  return {timeline,srt:buildSrtFromCaptions(captions),vtt:buildVttFromCaptions(captions),settingsSnapshot,
    settingsHash:await hashNarrationSubtitleSettings(settingsSnapshot),timingHash,builderVersion:NARRATION_SUBTITLE_BUILDER_VERSION};
}
