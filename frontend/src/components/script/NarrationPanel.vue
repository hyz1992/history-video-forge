<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch,type CSSProperties} from 'vue';
import type {NarrationStore} from '../../stores/narration';
import {makeSubtitleContainerStyle} from '../../../../renderer/src/subtitle-rendering';
const props=defineProps<{store:NarrationStore;estimatedDurationSec:number}>();
const emit=defineEmits<{(e:'proceed'):void}>();
const s=computed(()=>props.store.state),d=computed(()=>s.value.detail),c=computed(()=>s.value.context);
const status=computed(()=>d.value?.effective_status??'empty');
const labels:Record<string,string>={empty:'尚未生成口播',generating:'口播生成中',ready:'口播已生成，等待试听确认',confirmed:'口播已确认',failed:'口播生成失败',cancelled:'口播已取消',unknown:'供应商结果未知，请先核对费用后再决定重新生成',stale:'口播已过期，请重新生成'};
const failureLabels:Record<string,string>={narration_timing_invalid:'原生时间校验未通过',narration_provider_unknown:'供应商结果未知，请核对已有费用',narration_text_too_long:'正文超出供应商长度限制',narration_paragraph_too_long:'段落超出供应商长度限制'};
const needsConfirmation=computed(()=>status.value==='ready'||(status.value==='confirmed'&&s.value.snapshot?.narration_readiness?.reason==='narration_duration_not_accepted'));
async function confirmAndProceed(){await props.store.confirm(accepted.value);if(props.store.canProceed())emit('proceed');}
const accepted=ref(false),editing=ref(false),optionIndex=ref(0),tone=ref('neutral'),rate=ref(1),time=ref(0);
const selected=computed(()=>c.value?.options[optionIndex.value]);
const band=computed(()=>c.value?.target_duration_band),duration=computed(()=>d.value?.record.output?.durationMs??null);
const outside=computed(()=>duration.value!==null&&!!band.value&&(duration.value<band.value.minMs||duration.value>band.value.maxMs));
watch([()=>d.value?.record.id,()=>band.value?.minMs,()=>band.value?.maxMs],()=>{accepted.value=false;});
watch(()=>d.value?.record.id,()=>{time.value=0;});
function beginEdit(){const config=c.value?.configuration;optionIndex.value=Math.max(0,c.value?.options.findIndex(o=>o.provider_model_id===config?.capabilities['tts.synthesize'].provider_model_id&&o.voice_profile_id===config?.creative.voice_profile_id)??0);tone.value=config?.creative.narration?.tone??selected.value?.supported_tones[0]??'neutral';rate.value=config?.creative.narration?.rate??selected.value?.supported_rates[0]??1;editing.value=true;}
function recommend(){const i=c.value?.options.findIndex(o=>o.provider_model_id===c.value?.recommended_provider_model_id&&o.voice_profile_id===c.value?.recommended_voice_profile_id)??-1;if(i>=0){optionIndex.value=i;tone.value=selected.value!.supported_tones[0]!;rate.value=selected.value!.supported_rates[0]!;}}
function selectOption(){tone.value=selected.value?.supported_tones[0]??'neutral';rate.value=selected.value?.supported_rates[0]??1;}
async function save(){if(!selected.value)return;await props.store.saveSettings({...selected.value,tone:tone.value,rate:rate.value});if(!s.value.error)editing.value=false;}
const cue=computed(()=>d.value?.subtitle?.timeline.cues.find(q=>time.value*1000>=q.displayStartMs&&time.value*1000<q.displayEndMs));
const subtitleStyle=computed(()=>{const style=d.value?.subtitle?.revision.subtitleSettingsSnapshotJson.resolvedStyle;if(!style)return {};const css=makeSubtitleContainerStyle({frameWidth:1080,frameHeight:1920,style});return Object.fromEntries(Object.entries(css).map(([k,v])=>[k,typeof v==='number'&&['left','right','top','bottom','fontSize'].includes(k)?v+'px':v])) as CSSProperties;});
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false;
async function tick(){if(disposed)return;await props.store.refresh();if(!disposed&&status.value==='generating')timer=setTimeout(tick,1500);}
watch(status,v=>{if(timer)clearTimeout(timer);if(v==='generating')timer=setTimeout(tick,1500);},{immediate:true});
onBeforeUnmount(()=>{disposed=true;if(timer)clearTimeout(timer);});
</script>
<template>
<section class="narration-panel" data-testid="narration-panel">
<h2>准备口播</h2><p data-testid="narration-status" aria-live="polite">{{ labels[status] }}</p>
<p v-if="d?.record.errorCode" data-testid="narration-failure-reason">失败原因：{{ failureLabels[d.record.errorCode] ?? d.record.errorCode }}</p>
<p v-if="s.error" role="alert">{{ s.error }}</p>
<p>文案预估 {{ estimatedDurationSec }} 秒 · 实测 {{ duration===null?'尚未生成':(duration/1000)+' 秒' }}<template v-if="band"> · 目标 {{ band.minMs/1000 }}–{{ band.maxMs/1000 }} 秒</template></p>
<p v-if="duration!==null">实测与预估差值：{{ (duration/1000-estimatedDurationSec).toFixed(2) }} 秒</p>
<p v-if="d">本次口播：{{ d.record.settings.model }} · {{ d.record.settings.voice }}</p>
<p v-else-if="c?.configuration">项目固定模型：{{ c.configuration.capabilities['tts.synthesize'].provider_model_id }} · {{ c.configuration.creative.voice_profile_id }}</p>
<button :disabled="s.busy||status==='generating'" data-testid="edit-narration-settings" @click="beginEdit">编辑口播设置</button>
<div v-if="editing" class="narration-settings">
<p>保存生效参数变化会使已确认口播及下游分镜、资产、合成和发布失效；历史文件保留。</p>
<label>模型与音色 <select v-model="optionIndex" @change="selectOption"><option v-for="(o,i) in c?.options" :key="o.voice_profile_id" :value="i">{{ o.model }} · {{ o.voice }}</option></select></label>
<label>情感 <select v-model="tone" data-testid="narration-tone" :disabled="!selected||selected.supported_tones.length<=1"><option v-for="v in selected?.supported_tones" :key="v" :value="v">{{ v==='neutral'?'中性':v }}</option></select></label>
<label>语速 <select v-model="rate" :disabled="!selected||selected.supported_rates.length<=1"><option v-for="v in selected?.supported_rates" :key="v" :value="v">{{ v }} 倍</option></select></label>
<p>仅显示已通过资格验证的参数。</p><button @click="recommend">应用推荐到草稿</button><button :disabled="s.busy||!selected" @click="save">保存项目设置</button><button data-testid="cancel-settings" @click="editing=false">取消编辑</button>
</div>
<button v-if="!s.snapshot?.script_confirmation" :disabled="s.busy||!c?.source_script_record_id" @click="store.confirmScript">确认正文</button>
<button v-if="status!=='generating'" :disabled="s.busy||!s.snapshot?.script_confirmation||editing" @click="store.generate">{{ d?'重新生成口播':'生成口播' }}</button>
<button v-else :disabled="s.busy" @click="store.cancel">取消本次生成</button>
<button :disabled="s.loading" @click="store.refresh()">刷新状态</button>
<template v-if="d?.files?.audio">
<audio :key="d.record.id" controls :src="d.files.audio" @timeupdate="time=($event.target as HTMLAudioElement).currentTime" />
<div v-if="d.subtitle" class="subtitle-viewport" aria-label="冻结字幕样式预览"><div class="subtitle-canvas"><div :style="subtitleStyle">{{ cue?.text??'' }}</div></div></div>
<p v-else>字幕预览暂不可用，请刷新状态。</p>
</template>
<template v-if="needsConfirmation">
<p v-if="status==='confirmed'">目标区间已变化，可复用这版音频重新确认，无需重新生成。</p>
<p v-if="outside">实测时长超出目标区间，请重新生成或明确接受本次时长。</p>
<label v-if="outside"><input v-model="accepted" data-testid="accept-duration" type="checkbox">我接受本次超区间时长</label>
<button data-testid="narration-confirm" :disabled="s.busy||!band||(outside&&!accepted)" @click="confirmAndProceed">确认这版口播</button>
</template>
<p v-if="s.snapshot?.narration_readiness?.reason==='narration_stale'">正文或生效参数已变化，原口播已过期。</p>
<button :disabled="!store.canProceed()||s.busy" @click="emit('proceed')">进入分镜规划</button>
</section>
</template>
<style scoped>
.narration-panel{display:grid;gap:12px;padding:20px;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-card);color:var(--text-body)}h2,p{margin:0}h2{font-size:20px}button,select{padding:8px 12px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-panel);color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.narration-settings{display:grid;gap:10px;padding:12px;border:1px solid var(--border-default)}audio{width:100%}.subtitle-viewport{width:270px;height:480px;max-width:100%;overflow:hidden;position:relative;background:#28231f}.subtitle-canvas{position:relative;width:1080px;height:1920px;transform:scale(.25);transform-origin:top left;white-space:pre-line}
</style>
