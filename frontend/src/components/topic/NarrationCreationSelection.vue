<script setup lang="ts">
import { computed, ref } from "vue";
import type { NarrationCreationPending } from "../../composables/useNarrationProjectCreation";
const props = defineProps<{ pending: NarrationCreationPending }>();
const emit = defineEmits<{
  (e: "confirm", selection: { provider_model_id: string; voice_profile_id: string; policy_version: string }): void;
  (e: "cancel"): void;
}>();
const optionIndex = ref<number | null>(null);
const choice = computed(() => (optionIndex.value === null ? null : props.pending.options[optionIndex.value] ?? null));
function confirm() {
  if (!choice.value) return;
  emit("confirm", {
    provider_model_id: choice.value.provider_model_id,
    voice_profile_id: choice.value.voice_profile_id,
    policy_version: props.pending.policyVersion,
  });
}
</script>
<template>
<section class="narration-creation-selection" data-testid="narration-creation-selection">
<h3>选择口播模型与音色</h3>
<p data-testid="narration-creation-reason">{{ pending.reason }}</p>
<p>新项目将以口播前置模式运行：确认文案后先生成整篇口播，再按真实时长规划分镜。请选择已通过资格验证的组合：</p>
<label v-for="(option, index) in pending.options" :key="option.voice_profile_id" class="narration-creation-option-row">
  <input
    type="radio"
    name="narration-creation-option"
    data-testid="narration-creation-option"
    :value="String(index)"
    :checked="optionIndex === index"
    @change="optionIndex = index"
  />
  <span>{{ option.model }} · {{ option.voice }}</span>
</label>
<p>选定后将带该组合重新创建项目；取消则不创建任何项目。</p>
<button :disabled="!choice" data-testid="narration-creation-confirm" @click="confirm">确认并创建</button>
<button data-testid="narration-creation-cancel" @click="emit('cancel')">取消</button>
</section>
</template>
<style scoped>
.narration-creation-selection{display:grid;gap:8px;padding:14px;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-card);color:inherit}h3,p{margin:0}button{justify-self:start;padding:8px 12px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-panel);color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
</style>
