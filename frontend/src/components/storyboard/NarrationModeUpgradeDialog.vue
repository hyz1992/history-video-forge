<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiFetch } from "../../utils/api";
import type { NarrationModeUpgradePreviewV1 } from "../../../../shared/src/narration/narration-ui.schema";
const props = defineProps<{ projectId: string; api?: { preview: (projectId: string) => Promise<NarrationModeUpgradePreviewV1>; upgrade: (projectId: string, body: unknown) => Promise<unknown> } }>();
const emit = defineEmits<{ (e: "upgraded"): void; (e: "cancel"): void }>();
const preview = ref<NarrationModeUpgradePreviewV1 | null>(null), error = ref<string | null>(null), busy = ref(false), optionIndex = ref(0);
const defaultApi = {
  preview: (id: string) => apiFetch<NarrationModeUpgradePreviewV1>(`/api/projects/${encodeURIComponent(id)}/narration-mode/upgrade/preview`),
  upgrade: (id: string, body: unknown) => apiFetch(`/api/projects/${encodeURIComponent(id)}/narration-mode/upgrade`, { method: "POST", body }),
};
const resolved = computed(() => props.api ?? defaultApi);
const stageField: Record<string, string> = { storyboard: "storyboard_record_id", asset_plan: "asset_plan_record_id", assets: "asset_manifest_record_id", compose: "compose_record_id", render: "render_job_record_id", publish: "publish_package_record_id" };
const stageLabel: Record<string, string> = { storyboard: "分镜", asset_plan: "资产计划", assets: "资产生成", compose: "合成", render: "渲染", publish: "发布交付" };
onMounted(async () => {
  try { preview.value = await resolved.value.preview(props.projectId); }
  catch (e) { error.value = e instanceof Error ? e.message : "升级预览加载失败"; }
});
const currentModel = computed(() => {
  const c = preview.value?.current_configuration;
  return c?.tts_mode === "fixed" ? `${c.provider_model_id} · ${c.voice_profile_id ?? ""}` : "自动（跟随全局默认）";
});
async function confirm() {
  const p = preview.value;
  if (!p || busy.value || !p.upgrade_available) return;
  busy.value = true; error.value = null;
  try {
    const downstream: Record<string, string | null> = { storyboard_record_id: null, asset_plan_record_id: null, asset_manifest_record_id: null, compose_record_id: null, render_job_record_id: null, publish_package_record_id: null };
    for (const a of p.affected) downstream[stageField[a.stage]] = a.record_id;
    const option = p.options[optionIndex.value];
    await resolved.value.upgrade(props.projectId, {
      expected_active_script_record_id: p.script.active_script_record_id,
      expected_configuration_revision: p.current_configuration.revision,
      expected_downstream: downstream,
      narration_selection: { provider_model_id: option.provider_model_id, voice_profile_id: option.voice_profile_id, policy_version: p.policy_version },
      confirm_invalidation: true,
    });
    emit("upgraded");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "口播模式升级失败";
  } finally { busy.value = false; }
}
</script>
<template>
<section class="narration-upgrade" data-testid="narration-upgrade-dialog">
<h2>升级到口播前置模式</h2>
<p>升级在一次事务中切换模式、固定合格模型音色，并使下游分镜、资产、合成、发布结果失效；历史文件保留，需回到文案页重新生成并确认口播。</p>
<p v-if="error" role="alert">{{ error }}</p>
<template v-if="preview">
<p v-if="!preview.upgrade_available" data-testid="narration-upgrade-unavailable">口播前置模式尚未开放，暂时不能升级；既有内容可继续查看与导出。</p>
<template v-else>
<div data-testid="narration-upgrade-affected">
<p>以下结果将被失效：</p>
<ul><li v-for="a in preview.affected" :key="a.stage">{{ stageLabel[a.stage] ?? a.stage }} · {{ a.record_id }}</li></ul>
<p v-if="preview.affected.length === 0">当前没有下游结果需要失效。</p>
</div>
<p>当前口播配置：<span data-testid="narration-upgrade-current">{{ currentModel }}</span>（配置 revision {{ preview.current_configuration.revision }}）</p>
<label>目标模型与音色 <select data-testid="narration-upgrade-option" v-model="optionIndex"><option v-for="(o, i) in preview.options" :key="o.voice_profile_id" :value="i">{{ o.model }} · {{ o.voice }}</option></select></label>
<p>升级完成后回到文案页生成并确认口播，才能重新进入分镜。</p>
</template>
<button :disabled="busy || !preview.upgrade_available || !preview.script.active_script_record_id || preview.options.length === 0" data-testid="narration-upgrade-confirm" @click="confirm">确认升级</button>
<button :disabled="busy" data-testid="narration-upgrade-cancel" @click="emit('cancel')">取消</button>
</template>
</section>
</template>
<style scoped>
.narration-upgrade{display:grid;gap:10px;padding:16px;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-panel);color:inherit}h2,p,li{margin:0}h2{font-size:18px}button,select{padding:8px 12px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-card);color:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}ul{margin:0;padding-left:18px}
</style>
