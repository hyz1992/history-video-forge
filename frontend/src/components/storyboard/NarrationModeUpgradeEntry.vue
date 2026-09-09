<script setup lang="ts">
import { computed, ref } from "vue";
import type { NarrationModeUpgradePreviewV1 } from "../../../../shared/src/narration/narration-ui.schema";
import NarrationModeUpgradeDialog from "./NarrationModeUpgradeDialog.vue";
const props = defineProps<{ projectId: string | null | undefined; snapshotNarrationMode: string | null | undefined; api?: { preview: (projectId: string) => Promise<NarrationModeUpgradePreviewV1>; upgrade: (projectId: string, body: unknown) => Promise<unknown> } }>();
const emit = defineEmits<{ (e: "upgraded"): void }>();
const open = ref(false);
const isLegacy = computed(() => props.snapshotNarrationMode === "legacy_estimated");
function onUpgraded() {
  open.value = false;
  emit("upgraded");
}
</script>
<template>
<div v-if="isLegacy && projectId" class="narration-upgrade-entry">
  <p>该项目仍按文本估算时长。升级后将以整篇口播的真实时间轴驱动分镜、资产与合成；升级会使现有下游结果失效，历史文件保留。</p>
  <button v-if="!open" data-testid="narration-upgrade-entry" @click="open = true">升级到口播前置模式</button>
  <NarrationModeUpgradeDialog v-else :project-id="projectId" :api="api" @upgraded="onUpgraded" @cancel="open = false" />
</div>
</template>
<style scoped>
.narration-upgrade-entry{display:grid;gap:8px;padding:14px;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-card);color:inherit}p{margin:0}button{justify-self:start;padding:8px 12px;border:1px solid var(--border-default);border-radius:6px;background:var(--bg-panel);color:inherit;cursor:pointer}
</style>
