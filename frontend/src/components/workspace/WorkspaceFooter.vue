<script setup lang="ts">
import { ElButton, ElIcon } from "element-plus";
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue";

import { useWorkspaceStore } from "../../stores/workspace";

const workspaceStore = useWorkspaceStore();
</script>

<template>
  <footer class="workspace-footer">
    <div class="footer-left">
      <ElButton
        :disabled="workspaceStore.isFirstStep()"
        @click="workspaceStore.prevStep()"
      >
        <ElIcon><ArrowLeft /></ElIcon>
        上一步
      </ElButton>
    </div>

    <div class="footer-center">
      <slot />
    </div>

    <div class="footer-right">
      <ElButton
        type="primary"
        :disabled="workspaceStore.isLastStep()"
        @click="workspaceStore.nextStep()"
      >
        下一步
        <ElIcon><ArrowRight /></ElIcon>
      </ElButton>
    </div>
  </footer>
</template>

<style scoped>
.workspace-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 var(--space-lg);
  border-top: 1px solid var(--border-default);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  min-width: 120px;
}

.footer-right {
  justify-content: flex-end;
}

.footer-center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
</style>
