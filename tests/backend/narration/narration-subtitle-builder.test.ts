import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_STYLE, NarrationSubtitleSettingsSnapshot, NarrationSubtitleTimelineV1, canonicalStringify, hashNarrationSubtitleSettings } from '../../../shared/src/index.js';
import { normalizeNarrationTiming } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
import { buildNarrationSubtitles } from '../../../backend/src/modules/narration/narration-subtitle-builder.js';

function settings(maxCharactersPerLine = 2, max_lines = 2): NarrationSubtitleSettingsSnapshot {
  return {presetId:'subtitle_style_default_vertical',presetVersion:'v1',resolvedStyle:{...DEFAULT_SUBTITLE_STYLE,max_lines},overrides:{},lineBreak:{strategy:'punctuation_and_length',maxCharactersPerLine,version:'v1'},resolverVersion:'v1'};
}
function timing(sourceText: string, spokenText = sourceText, times?: number[][], tail = 0) {
  const words=Array.from(spokenText).map((text,i)=>({text,begin_index:i,end_index:i+1,begin_time:times?.[i]?.[0]??i*250,end_time:times?.[i]?.[1]??(i+1)*250}));
  return normalizeNarrationTiming({sourceText,audioHash:'a'.repeat(64),durationMs:Math.max(...words.map(w=>w.end_time))+tail,sentences:[{providerSentenceIndex:0,originalText:sourceText,normalizedText:spokenText,words}]});
}
describe('原生字幕确定性派生',()=>{
  it('close gaps 只延长display，speech及raw图不变，尾静音不拉长',async()=>{
    const map=timing('甲乙丙丁','甲乙丙丁',[[100,200],[200,300],[1200,1400],[1400,1700]],500), raw=canonicalStringify(map);
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(2,1)});
    expect(result.timeline.cues.map((c:any)=>[c.speechStartMs,c.speechEndMs,c.displayStartMs,c.displayEndMs])).toEqual([[100,300,100,1200],[1200,1700,1200,1700]]);
    expect(canonicalStringify(map)).toBe(raw);
    expect(result.srt).toContain('00:00:00,100 --> 00:00:01,200');
    expect(result.vtt).toContain('00:00:01.200 --> 00:00:01.700');
    expect(NarrationSubtitleTimelineV1.safeParse(result.timeline).success).toBe(true);
  });
  it('字数与max_lines均生效，换行不改变每个cue的原生首尾',async()=>{
    const map=timing('甲乙丙丁戊己');
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings()});
    expect(result.timeline.cues.map((c:any)=>c.text)).toEqual(['甲乙\n丙丁','戊己']);
    expect(result.timeline.cues.map((c:any)=>[c.speechStartMs,c.speechEndMs])).toEqual([[0,1000],[1000,1500]]);
  });
  it('标点分句、Unicode、数字、空白保留原文，显示规范化',async()=>{
    const map=timing('12，𠮷！e\u0301😀\n乙。','十二，吉！e\u0301😀\n乙。');
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(12,2)});
    expect(result.timeline.cues.map((c:any)=>c.text).join('')).toContain('12，𠮷！');
    expect(result.timeline.cues.flatMap((c:any)=>[c.sourceStart,c.sourceEnd]).every((offset:number)=>!map.sourceSpans.some(s=>s.sourceStart<offset&&offset<s.sourceEnd))).toBe(true);
    expect(map.sourceText).toBe('12，𠮷！e\u0301😀\n乙。');
  });
  it('长不可拆source单元明确拒绝，不均分token时间',async()=>{
    const map=timing('1024','一千零二十四');
    await expect(buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(2,2)})).rejects.toThrow('narration_subtitle_unsplittable_span');
  });
  it('零时长归并单元只能整体分配speech时间',async()=>{
    const result=await buildNarrationSubtitles({timingMap:timing('甲乙丙','甲乙丙',[[0,250],[250,250],[250,500]]),settingsSnapshot:settings(2,1)});
    expect(result.timeline.cues.map((c:any)=>[c.text,c.speechStartMs,c.speechEndMs])).toEqual([['甲乙',0,250],['丙',250,500]]);
  });
  it('英文和中英混排原文空格规范为单空格，不吞掉词间分隔',async()=>{
    const sourceText='hello   world 与 AI';
    const words=['hello   ','world ','与 ','AI'].map((text,i)=>({text,begin_index:i,end_index:i+1,begin_time:i*250,end_time:(i+1)*250}));
    const map=normalizeNarrationTiming({sourceText,audioHash:'a'.repeat(64),durationMs:1000,sentences:[{providerSentenceIndex:0,originalText:sourceText,normalizedText:sourceText,words}]});
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(20,2)});
    expect(result.timeline.cues[0].text).toBe('hello world 与 AI');
    const wrapped=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(6,2)});
    expect(wrapped.timeline.cues.every((c:any)=>c.text.split('\n').every((line:string)=>line===line.trim()&&[...line].length<=6))).toBe(true);
  });
  it('完整snapshot可反序列化，preset变化不回写旧结果，同SRT异样式hash不同',async()=>{
    const snapshot=settings(20), map=timing('甲乙');
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:snapshot});
    const saved=JSON.stringify(result);
    snapshot.resolvedStyle.font_size_px=60;
    const next=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:snapshot});
    expect(JSON.stringify(result)).toBe(saved);
    expect(NarrationSubtitleSettingsSnapshot.parse(JSON.parse(saved).settingsSnapshot).resolvedStyle.font_size_px).toBe(46);
    expect(result.srt).toBe(next.srt);expect(result.settingsHash).not.toBe(next.settingsHash);
    expect(result.settingsHash).toBe(await hashNarrationSubtitleSettings(result.settingsSnapshot));
  });
  it.each([null,{}, {timingMap:{tokens:[]},settingsSnapshot:settings()}, {timingMap:{...timing('甲'),durationMs:0},settingsSnapshot:settings()}, {timingMap:timing('甲'),settingsSnapshot:{presetId:'x'}}])('畸形完整输入或缺原生时间拒绝',async value=>{
    await expect(buildNarrationSubtitles(value)).rejects.toThrow('narration_subtitle_input_invalid');
  });
  /** 显式 words 构造：用于"单个 word 跨过被吞标点"与"单词发声内容本身超限"两类形状。 */
  function timingWithWords(sourceText: string, words: Array<{text:string;t0:number;t1:number}>): any {
    return normalizeNarrationTiming({sourceText,audioHash:'a'.repeat(64),durationMs:Math.max(...words.map(w=>w.t1)),
      sentences:[{providerSentenceIndex:0,originalText:sourceText,normalizedText:words.map(w=>w.text).join(''),
        words:words.map((w,i)=>({text:w.text,begin_index:i,end_index:i+1,begin_time:w.t0,end_time:w.t1}))}]});
  }
  it.each([
    ['边界外空隙','甲'+'。'.repeat(30)+'乙','甲乙',18],
    ['前缀空隙','。'.repeat(30)+'甲乙','甲乙',18],
  ])('%s：未发声静音不挤爆字幕行，显示等于发声内容',async(_label,source,spoken,limit)=>{
    const map=timing(source,spoken);
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(limit as number,2)});
    // 显示文本恰好等于发声内容（被剥离的只会是未发声静音）
    expect(result.timeline.cues.map((c:any)=>c.text).join('').replace(/\s/gu,'')).toBe(spoken);
    // cue 来源范围仍覆盖完整原文（映射完整性不受显示剥离影响）
    expect(result.timeline.cues.at(-1)!.sourceEnd).toBe(map.sourceText.length);
    expect(NarrationSubtitleTimelineV1.safeParse(result.timeline).success).toBe(true);
  });
  it('词内空档（单个 word 跨过被吞标点）同样按未发声差额剥离',async()=>{
    const map=timingWithWords('甲。乙',[{text:'甲乙',t0:0,t1:500}]);
    const result=await buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(2,2)});
    expect(result.timeline.cues.map((c:any)=>c.text).join('')).toBe('甲乙');
    expect(result.timeline.cues.at(-1)!.sourceEnd).toBe(map.sourceText.length);
  });
  it('发声内容本身超限时仍拒绝（fail-closed 未被放宽）',async()=>{
    const map=timingWithWords('一千零二十四'+'。'.repeat(30),[{text:'一千零二十四',t0:0,t1:500}]);
    await expect(buildNarrationSubtitles({timingMap:map,settingsSnapshot:settings(2,2)})).rejects.toThrow('narration_subtitle_unsplittable_span');
  });
});
