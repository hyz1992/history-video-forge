<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import type { NarrationStore } from "../../stores/narration";

const props = defineProps<{
  store: NarrationStore;
  visible: boolean;
  estimatedDurationSec: number;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

const s = computed(() => props.store.state);
const d = computed(() => s.value.detail);
const c = computed(() => s.value.context);
const status = computed(() => d.value?.effective_status ?? "empty");
const sourceGenerating = computed(() => s.value.snapshot?.latest_narration_candidate?.effective_status === "generating");
const polling = computed(() => status.value === "generating" || sourceGenerating.value);

const labels: Record<string, string> = {
  empty: "尚未生成口播",
  generating: "口播生成中，约 1-2 分钟",
  ready: "口播已生成，请试听并确认",
  confirmed: "口播已确认",
  failed: "口播生成失败",
  cancelled: "口播已取消",
  unknown: "供应商结果未知，请先核对费用",
  stale: "口播已过期，请重新生成",
};
const failureLabels: Record<string, string> = {
  narration_timing_invalid: "原生时间校验未通过",
  narration_provider_unknown: "供应商结果未知，请核对已有费用",
  narration_text_too_long: "正文超出供应商长度限制",
  narration_paragraph_too_long: "段落超出供应商长度限制",
};

const editing = ref(false);
const optionIndex = ref(0);
const tone = ref("neutral");
const rate = ref(1);
const accepted = ref(false);
const busy = computed(() => s.value.busy || s.value.loading);

const selected = computed(() => c.value?.options[optionIndex.value]);
const band = computed(() => c.value?.target_duration_band);
const duration = computed(() => d.value?.record.output?.durationMs ?? null);
const outside = computed(() => duration.value !== null && !!band.value && (duration.value < band.value.minMs || duration.value > band.value.maxMs));
const needsConfirmation = computed(() => status.value === "ready" || (status.value === "confirmed" && s.value.snapshot?.narration_readiness?.reason === "narration_duration_not_accepted"));

// 人类可读声音摘要：优先取当前配置对应的选项显示名，缺失才退回配置 ID。
const voiceSummary = computed(() => {
  const cfg = c.value?.configuration;
  if (!cfg) return null;
  const modelId = cfg.capabilities["tts.synthesize"].provider_model_id;
  const voiceId = cfg.creative.voice_profile_id;
  const hit = c.value?.options.find((o) => o.provider_model_id === modelId && o.voice_profile_id === voiceId);
  return hit ? { model: hit.model, voice: hit.voice } : { model: modelId, voice: voiceId };
});

function close() {
  emit("update:visible", false);
}

function beginEdit() {
  const cfg = c.value?.configuration;
  optionIndex.value = Math.max(0, c.value?.options.findIndex((o) => o.provider_model_id === cfg?.capabilities["tts.synthesize"].provider_model_id && o.voice_profile_id === cfg?.creative.voice_profile_id) ?? 0);
  tone.value = cfg?.creative.narration?.tone ?? selected.value?.supported_tones[0] ?? "neutral";
  rate.value = cfg?.creative.narration?.rate ?? selected.value?.supported_rates[0] ?? 1;
  editing.value = true;
}

function selectOption() {
  tone.value = selected.value?.supported_tones[0] ?? "neutral";
  rate.value = selected.value?.supported_rates[0] ?? 1;
}

function recommend() {
  const i = c.value?.options.findIndex((o) => o.provider_model_id === c.value?.recommended_provider_model_id && o.voice_profile_id === c.value?.recommended_voice_profile_id) ?? -1;
  if (i >= 0) {
    optionIndex.value = i;
    tone.value = selected.value!.supported_tones[0]!;
    rate.value = selected.value!.supported_rates[0]!;
  }
}

async function save() {
  if (!selected.value) return;
  await props.store.saveSettings({ ...selected.value, tone: tone.value, rate: rate.value });
  if (!s.value.error) editing.value = false;
}

// 生成：未确认正文时先自动确认，用户无感知。
async function handleGenerate() {
  if (!s.value.snapshot?.script_confirmation) {
    await props.store.confirmScript();
    if (!s.value.snapshot?.script_confirmation) return;
  }
  await props.store.generate();
}

async function confirmAndClose() {
  await props.store.confirm(accepted.value);
  if (props.store.canProceed()) close();
}

watch(() => props.visible, (v) => {
  if (v) {
    accepted.value = false;
    editing.value = false;
    void props.store.refresh();
  }
}, { immediate: true });

// 生成中轮询，关闭弹窗即停（入口卡继续轮询）。
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
async function tick() {
  if (disposed) return;
  await props.store.refresh();
  if (!disposed && polling.value) timer = setTimeout(tick, 2000);
}
watch(polling, (v) => {
  if (timer) clearTimeout(timer);
  if (v) timer = setTimeout(tick, 2000);
});
onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal-box" data-testid="narration-dialog">
        <button class="modal-close" aria-label="关闭" @click="close">✕</button>

        <div class="modal-title">生成整篇口播</div>

        <!-- 声音摘要 -->
        <div class="modal-section">
          <div class="summary-line" data-testid="narration-voice-summary">
            <template v-if="voiceSummary">声音：{{ voiceSummary.voice }} · {{ voiceSummary.model }}</template>
            <template v-else>声音：尚未选定</template>
          </div>
          <p class="summary-meta">
            文案预估 {{ estimatedDurationSec }} 秒<template v-if="duration !== null"> · 实测 {{ (duration / 1000).toFixed(1) }} 秒</template><template v-if="band"> · 目标 {{ band.minMs / 1000 }}–{{ band.maxMs / 1000 }} 秒</template>
          </p>
          <p class="summary-cost">按实际字数计费，生成后费用计入项目费用清单。</p>
        </div>

        <!-- 状态与错误 -->
        <p class="status" data-testid="narration-dialog-status" aria-live="polite">{{ labels[status] }}</p>
        <p v-if="d?.record.errorCode" class="failure" data-testid="narration-failure-reason">
          失败原因：{{ failureLabels[d.record.errorCode] ?? d.record.errorCode }}
        </p>
        <p v-if="s.error" class="failure" role="alert">{{ s.error }}</p>
        <p v-if="s.snapshot?.narration_readiness?.reason === 'narration_stale'" class="stale">正文或生效参数已变化，原口播已过期。</p>

        <!-- 设置（折叠） -->
        <button class="settings-toggle" data-testid="edit-narration-settings" @click="editing ? (editing = false) : beginEdit()">
          {{ editing ? "收起口播设置" : "编辑口播设置" }}
        </button>
        <div v-if="editing" class="narration-settings" data-testid="narration-settings">
          <p>保存生效参数变化会使已确认口播及下游分镜、资产、合成和发布失效；历史文件保留。</p>
          <label>
            模型与音色
            <select v-model="optionIndex" @change="selectOption">
              <option v-for="(o, i) in c?.options" :key="o.voice_profile_id" :value="i">{{ o.model }} · {{ o.voice }}</option>
            </select>
          </label>
          <label>
            情感
            <select v-model="tone" data-testid="narration-tone" :disabled="!selected || selected.supported_tones.length <= 1">
              <option v-for="v in selected?.supported_tones" :key="v" :value="v">{{ v === "neutral" ? "中性" : v }}</option>
            </select>
          </label>
          <label>
            语速
            <select v-model="rate" :disabled="!selected || selected.supported_rates.length <= 1">
              <option v-for="v in selected?.supported_rates" :key="v" :value="v">{{ v }} 倍</option>
            </select>
          </label>
          <p>仅显示已通过资格验证的参数。</p>
          <div class="settings-actions">
            <button @click="recommend">应用推荐到草稿</button>
            <button :disabled="busy || !selected" @click="save">保存项目设置</button>
          </div>
        </div>

        <!-- 生成 / 取消 -->
        <div class="generate-row">
          <button
            v-if="status !== 'generating' && !sourceGenerating"
            class="primary"
            data-testid="narration-generate"
            :disabled="busy || !!d"
            @click="handleGenerate"
          >
            {{ d ? "重新生成口播" : "生成整篇口播" }}
          </button>
          <button
            v-else
            class="primary"
            data-testid="narration-generating"
            disabled
          >
            生成中，约 1-2 分钟…
          </button>
          <button v-if="status === 'generating'" data-testid="narration-cancel" :disabled="busy" @click="props.store.cancel()">取消生成</button>
        </div>

        <!-- 试听与确认 -->
        <template v-if="d?.files?.audio">
          <audio :key="d.record.id" controls :src="d.files.audio" data-testid="narration-dialog-audio" />
        </template>

        <template v-if="needsConfirmation">
          <p v-if="outside">实测时长超出目标区间，可重新生成或明确接受本次时长。</p>
          <label v-if="outside" class="accept-line">
            <input v-model="accepted" data-testid="accept-duration" type="checkbox"> 我接受本次超区间时长
          </label>
          <button
            class="primary"
            data-testid="narration-confirm"
            :disabled="busy || !band || (outside && !accepted)"
            @click="confirmAndClose"
          >
            确认这版口播
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.modal-box {
  position: relative;
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  display: grid;
  gap: 12px;
  padding: 22px;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-body);
}
.modal-close {
  position: absolute;
  top: 10px;
  right: 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}
.modal-title {
  font-size: 18px;
  font-weight: 600;
}
.modal-section {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
}
.summary-line {
  font-size: 15px;
}
.summary-meta,
.summary-cost {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.status {
  margin: 0;
  font-size: 14px;
}
.failure,
.stale {
  margin: 0;
  font-size: 13px;
  color: var(--danger, #d9534f);
}
.settings-toggle {
  justify-self: start;
  padding: 7px 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-panel);
  color: inherit;
  cursor: pointer;
}
.narration-settings {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
}
.narration-settings p {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.narration-settings label {
  display: grid;
  gap: 4px;
  font-size: 13px;
}
.narration-settings select {
  padding: 7px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-panel);
  color: inherit;
}
.settings-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-actions button {
  padding: 7px 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-panel);
  color: inherit;
  cursor: pointer;
}
.generate-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
button.primary {
  padding: 9px 16px;
  border: 1px solid var(--accent-gold, #c9a227);
  border-radius: 8px;
  background: var(--accent-gold, #c9a227);
  color: #100c08;
  font-weight: 600;
  cursor: pointer;
}
button.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
audio {
  width: 100%;
}
.accept-line {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
</style>
