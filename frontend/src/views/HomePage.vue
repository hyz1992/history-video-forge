<template>
  <section class="home-page">
    <p class="home-kicker">Story Video Forge</p>
    <h1 data-testid="home-heading">Story Video Forge</h1>
    <p class="home-summary">
      把选题和文案工作区收拢到项目内，从新建项目开始追踪整个 topic -> script 主链路。
    </p>
    <p class="home-flow">选题 -> 确认 -> 生成文案</p>

    <div class="home-actions">
      <RouterLink data-testid="home-primary-cta" class="home-link" to="/projects">
        进入我的项目
      </RouterLink>
      <RouterLink data-testid="home-secondary-cta" class="home-link secondary" to="/projects">
        新建项目
      </RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<style scoped>
.home-page {
  display: grid;
  gap: 1rem;
  max-width: 40rem;
}

.home-kicker {
  margin: 0;
  color: #7c4d12;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.home-summary,
.home-flow {
  margin: 0;
}

.home-actions {
  display: flex;
  gap: 0.75rem;
}

.home-link {
  color: inherit;
}

.secondary {
  opacity: 0.82;
}
</style>
