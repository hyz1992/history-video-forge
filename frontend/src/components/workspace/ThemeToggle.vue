<script setup lang="ts">
import { ElButton, ElIcon, ElTooltip } from "element-plus";
import { Sunny, Moon } from "@element-plus/icons-vue";

import { useTheme } from "../../composables/useTheme";

const { currentTheme, toggleTheme } = useTheme();

const isDark = () => currentTheme.value === "cinematic-dark";
</script>

<template>
  <ElTooltip
    :content="isDark() ? '切换到浅色模式' : '切换到深色模式'"
    placement="bottom"
    :show-after="500"
  >
    <ElButton class="theme-toggle" circle @click="toggleTheme()">
      <ElIcon :size="16">
        <Moon v-if="isDark()" />
        <Sunny v-else />
      </ElIcon>
    </ElButton>
  </ElTooltip>
</template>

<style scoped>
.theme-toggle {
  color: var(--text-secondary);
  border-color: var(--border-default);
  background: transparent;
}

.theme-toggle:hover {
  color: var(--accent-text);
  border-color: var(--border-hover);
  background: var(--bg-hover);
}
</style>
