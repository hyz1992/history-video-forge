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
    const gapEnd=map.sourceSpans[i+1]?.sourceStart??map.sourceText.length;
    let raw=map.sourceText.slice(sourceStart,gapEnd);
    let unit=display(raw);
    if(length(unit)>limit){
      // 显示单元超限时剥离"未发声的静音字符"（供应商没读的标点/空白），使显示与音频一致。
      // 只在"确定未发声"的静音上剥离：span 覆盖范围之外的空隙与首个单元之前的正文前缀。
      // 这些字符不被任何 token/span 覆盖，合同保证必为静音（供应商吞标点后留下这类空档）。
      // span 内部的未发声静音无法从 timingMap 精确区分——token 区间跨过它，而发声文本长度
      // 与源覆盖字符数并不相等（数字读法膨胀、重复标点折叠），按差额剥离会误删发声标点——
      // 故该形状不剥离：覆盖部分本身超限时维持原错误（fail-closed）。
      // 只在超限分支生效：既有可容纳输入的输出逐字节不变；cue 的 source 范围仍覆盖完整原文。
      const kept=display(map.sourceText.slice(span.sourceStart,span.sourceEnd));
      if(length(kept)===0||length(kept)>limit)
        throw new Error('narration_subtitle_unsplittable_span');
      raw=map.sourceText.slice(span.sourceStart,span.sourceEnd);unit=kept;
    }
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
