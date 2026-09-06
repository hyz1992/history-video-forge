import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DashScopeSpeechWsClient } from '../../../backend/src/modules/narration/providers/dashscope-speech-ws-client.js';
import { DashScopeNarrationProvider } from '../../../backend/src/modules/narration/providers/dashscope-narration-provider.js';
const settings = {model:'qwen-audio-3.0-tts-plus',voice:'qwen-audio-3.0-tts-plus-longyimuling',region:'cn-beijing',protocol:'dashscope_ws',parametersVersion:'neutral-pcm24k-v1',tone:'neutral',rate:1,pitch:1,volume:50,sampleRate:24000,format:'pcm',textType:'PlainText',wordTimestampEnabled:true,enableSsml:false,seed:0,inputMode:'natural_paragraphs_single_task'};
class Socket extends EventEmitter {
  sent: any[] = []; closed=false; terminated=false;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() {this.closed=true;}
  terminate() {this.terminated=true;}
  json(event:string, payload:unknown={}) { this.emit('message',Buffer.from(JSON.stringify({header:{event,task_id:'task-1',attributes:{request_uuid:'request-1'}},payload})),false); }
  result(type:string, sentence:unknown, extra:object={}) {this.json('result-generated',{output:{type,sentence,...extra},usage:{characters:4}});}
}
function setup() {
  const socket=new Socket();const socketFactory=vi.fn(()=>socket);
  const client=new DashScopeSpeechWsClient({apiKey:'test-key',socketFactory,taskIdFactory:()=> 'task-1',timeoutMs:1000});
  const provider=new DashScopeNarrationProvider({client});
  return {socket,socketFactory,provider,client};
}
function begin(socket:Socket) {socket.emit('open');socket.json('task-started');socket.result('sentence-begin',{index:0},{original_text:'甲乙',normalized_text:'甲乙'});}
function end(socket:Socket) {socket.result('sentence-end',{index:0,words:[{text:'甲',begin_index:0,end_index:1,begin_time:0,end_time:250},{text:'乙',begin_index:1,end_index:2,begin_time:250,end_time:500}]},{original_text:'甲乙',normalized_text:'甲乙'});}
describe('独立DashScope口播provider',()=>{
  it('单task等待started发送自然段、仅一次finish，冻结参数且收齐PCM和原生时间',async()=>{
    const {socket,provider,socketFactory}=setup();
    const pending=provider.generate({sourceText:'甲乙',settings});
    socket.emit('open');expect(socket.sent.map(m=>m.header.action)).toEqual(['run-task']);
    socket.json('task-started');expect(socket.sent.map(m=>m.header.action)).toEqual(['run-task','continue-task','finish-task']);
    expect(socket.sent[0].payload).toMatchObject({model:settings.model,parameters:{voice:settings.voice,format:'pcm',sample_rate:24000,text_type:'PlainText',rate:1,pitch:1,volume:50,word_timestamp_enabled:true,enable_ssml:false,seed:0}});
    expect(socket.sent[0].payload.parameters).not.toHaveProperty('instructions');
    socket.result('sentence-begin',{index:0},{original_text:'甲乙',normalized_text:'甲乙'});
    const pcm=Buffer.alloc(24000);pcm.writeInt16LE(123,0);pcm.writeInt16LE(-456,23998);
    socket.emit('message',pcm.subarray(0,17),true);end(socket);socket.emit('message',pcm.subarray(17),true);
    socket.json('task-finished');const result=await pending;
    expect(result?.pcm).toEqual(pcm);expect(result.wav.subarray(44)).toEqual(pcm);
    expect(result.wav.toString('ascii',0,4)).toBe('RIFF');expect(result.wav.readUInt32LE(24)).toBe(24000);
    expect(result).toMatchObject({durationMs:500,sampleCount:12000,usageCharacters:4,providerTaskId:'task-1',providerRequestId:'request-1'});
    expect(result.timingMap.tokens).toHaveLength(2);expect(result.rawEvents.filter(e=>e.kind==='audio').map(e=>e.byteOffset)).toEqual([0,17]);
    expect(socketFactory).toHaveBeenCalledWith('wss://dashscope.aliyuncs.com/api-ws/v1/inference',expect.objectContaining({followRedirects:false,handshakeTimeout:15000,maxPayload:1048576}));
  });
  it('自然段保留CRLF和空行，片段串联不变且同task',async()=>{
    const {socket,client}=setup();const text='甲'.repeat(499)+'\r\n\n'+'乙'.repeat(500)+'\n'+'丙'.repeat(497);
    const pending=client.synthesize({sourceText:text,settings});const outcome=pending.catch(error=>error);
    socket.emit('open');socket.json('task-started');
    socket.emit('close'); const error=await outcome;
    const messages=socket.sent.filter(m=>m.header.action==='continue-task');
    expect(messages.map(m=>m.payload.input.text).join('')).toBe(text);expect(messages).toHaveLength(4);
    expect(new Set(socket.sent.map(m=>m.header.task_id))).toEqual(new Set(['task-1']));
    expect(error).toBeInstanceOf(Error); expect(error.message).toBe('narration_socket_closed');
  });
  it.each(['甲'.repeat(20001),'甲'.repeat(535),'甲'.repeat(1500),''])('输入超限/无自然段长文在联网前拒绝',async text=>{
    const {provider,socketFactory}=setup();await expect(provider.generate({sourceText:text,settings})).rejects.toThrow(/narration_(text|paragraph)/);expect(socketFactory).not.toHaveBeenCalled();
  });
  it.each([null,{}, {sourceText:'甲乙',settings:{...settings,tone:'sad'}},{sourceText:'甲乙',settings:{...settings,model:'cosyvoice-v3-flash'}}])('外部未知请求和未验证参数联网前拒绝',async input=>{
    const {provider,socketFactory}=setup();await expect(provider.generate(input)).rejects.toThrow('narration_request_invalid');expect(socketFactory).not.toHaveBeenCalled();
  });
  it.each(['disconnect','cancel','duplicate-end','missing-timestamp','odd-pcm','missing-audio','wrong-task','server-error'])('组合生命周期%s不返回成功bundle',async fault=>{
    const {socket,provider}=setup();const controller=new AbortController();const pending=provider.generate({sourceText:'甲乙',settings},{signal:controller.signal});
    const rejected=expect(pending).rejects.toThrow(/^narration_/);begin(socket);
    if(fault!=='missing-audio')socket.emit('message',Buffer.alloc(fault==='odd-pcm'?23999:24000),true);
    if(fault==='missing-timestamp')socket.result('sentence-end',{index:0,words:[]},{original_text:'甲乙',normalized_text:'甲乙'});else end(socket);
    if(fault==='disconnect')socket.emit('close');
    if(fault==='cancel')controller.abort();
    if(fault==='duplicate-end')end(socket);
    if(fault==='wrong-task')socket.emit('message',Buffer.from(JSON.stringify({header:{event:'task-finished',task_id:'other'}})),false);
    if(fault==='server-error')socket.json('task-failed',{error_message:'secret provider error'});
    socket.json('task-finished');await rejected;
  });
  it('累计usage取最大值不相加，final省略时允许完整成功的末句值',async()=>{
    const {socket,provider}=setup();const pending=provider.generate({sourceText:'甲乙',settings});begin(socket);
    socket.json('result-generated',{output:{type:'sentence-synthesis',sentence:{index:0}},usage:{characters:3}});
    socket.emit('message',Buffer.alloc(24000),true);end(socket);socket.json('task-finished',{usage:{characters:6}});
    expect((await pending)?.usageCharacters).toBe(6);
  });
  it('取消先发生则不联网且不接受后来finished',async()=>{
    const {provider,socketFactory}=setup();const controller=new AbortController();controller.abort();
    await expect(provider.generate({sourceText:'甲乙',settings},{signal:controller.signal})).rejects.toThrow('narration_cancelled');expect(socketFactory).not.toHaveBeenCalled();
  });
  it('injected client抛出敏感错误时稳定隔离错误来源',async()=>{
    const provider=new DashScopeNarrationProvider({client:{synthesize:async()=>{throw Error('secret-key');}}});
    await expect(provider.generate({sourceText:'甲乙',settings})).rejects.toThrow('narration_provider_failed');
  });
});

it('注入client不能用无终态原始事件冒充完整bundle',async()=>{
  const {socket,client}=setup();const pending=client.synthesize({sourceText:'甲乙',settings});begin(socket);socket.emit('message',Buffer.alloc(24000),true);end(socket);socket.json('task-finished');const complete=await pending;
  const invalid={...complete,rawEvents:complete.rawEvents.slice(0,-1)};
  const provider=new DashScopeNarrationProvider({client:{synthesize:async()=>invalid}});
  await expect(provider.generate({sourceText:'甲乙',settings})).rejects.toThrow('narration_capture_invalid');
});
it.each(['json','timestamp-first'])('只有音频和时间事件均齐备才完成：%s',async ordering=>{
  const {socket,provider}=setup();const pending=provider.generate({sourceText:'甲乙',settings});let resolved=false;void pending.then(()=>{resolved=true;});begin(socket);
  if(ordering==='timestamp-first')end(socket);
  socket.emit('message',Buffer.alloc(12000),true);await Promise.resolve();expect(resolved).toBe(false);
  if(ordering==='json')end(socket);
  socket.emit('message',Buffer.alloc(12000),true);socket.json('task-finished');expect((await pending).sampleCount).toBe(12000);
});
it('socket无结束事件超时拒绝并终止连接',async()=>{
  vi.useFakeTimers();try {const {socket,client}=setup();const pending=client.synthesize({sourceText:'甲乙',settings});const outcome=pending.catch(e=>e);socket.emit('open');await vi.advanceTimersByTimeAsync(1001);expect((await outcome).message).toBe('narration_timeout');expect(socket.terminated).toBe(true);}finally{vi.useRealTimers();}
});
it.each(['before-start','duplicate-start','bad-json','send-error','bad-usage','changing-request'])('协议失败%s稳定拒绝且无密钥泄露',async fault=>{
  const {socket,provider}=setup();const pending=provider.generate({sourceText:'甲乙',settings});const outcome=pending.catch(e=>e);
  if(fault==='send-error')socket.send=()=>{throw Error('secret');};
  socket.emit('open');
  if(fault==='before-start')socket.emit('message',Buffer.alloc(2),true);
  else if(fault==='bad-json')socket.emit('message',Buffer.from('{'),false);
  else {socket.json('task-started');if(fault==='duplicate-start')socket.json('task-started');if(fault==='bad-usage')socket.json('result-generated',{usage:{characters:-1}});if(fault==='changing-request')socket.emit('message',Buffer.from(JSON.stringify({header:{event:'result-generated',task_id:'task-1',attributes:{request_uuid:42}}})),false);}
  const error=await outcome;expect(error).toBeInstanceOf(Error);expect(error.message).toMatch(/^narration_/);expect(error.message).not.toContain('secret');
});

it('原始word属性顺序变化不改变同次原生证据',async()=>{
  const {socket,provider}=setup();const pending=provider.generate({sourceText:'甲乙',settings});begin(socket);socket.emit('message',Buffer.alloc(24000),true);
  socket.result('sentence-end',{index:0,words:[{end_time:250,text:'甲',begin_time:0,end_index:1,begin_index:0},{end_time:500,text:'乙',begin_time:250,end_index:2,begin_index:1}]},{original_text:'甲乙',normalized_text:'甲乙'});socket.json('task-finished');
  expect((await pending).timingMap.tokens).toHaveLength(2);
});
