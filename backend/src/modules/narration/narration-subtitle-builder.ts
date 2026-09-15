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
  const tokenById=new Map(map.tokens.map(t=>[t.id,t]));
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
      // token 区间会跨过未发声字符（供应商吞标点后两侧字符合并成一个 word），故用差额判定：
      // 未发声数 = 区间字符数 − 该 span 发声文本长度（合同保证未覆盖字符必为静音）。
      // 从后往前剥离且绝不触及非静音字符；剥离后仍超限或为空则维持原错误（fail-closed）。
      // 只在超限分支生效：既有可容纳输入的输出逐字节不变；cue 的 source 范围仍覆盖完整原文。
      const chars=Array.from(map.sourceText.slice(sourceStart,gapEnd));
      const voiced=Array.from(span.tokenIds.map(id=>tokenById.get(id)?.spokenText??'').join('')).length;
      let surplus=chars.length-voiced;
      let stripped='';
      for(let k=chars.length-1;k>=0;k-=1){
        const ch=chars[k]!;
        if(surplus>0&&/^[\p{P}\p{Z}\s]*$/u.test(ch)){surplus-=1;continue;}
        stripped=ch+stripped;
      }
      const strippedUnit=display(stripped);
      if(surplus>0||length(strippedUnit)===0||length(strippedUnit)>limit)
        throw new Error('narration_subtitle_unsplittable_span');
      raw=stripped;unit=strippedUnit;
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
