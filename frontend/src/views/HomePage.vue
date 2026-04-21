<template>
  <section class="home-page">
    <p data-testid="home-kicker" class="home-kicker">项目驱动 Topic + Script</p>

    <div class="home-hero">
      <div class="home-copy">
        <h1 data-testid="home-heading">Story Video Forge</h1>
        <p class="home-summary">
          把选题和文案工作区收拢到项目内，从新建项目开始追踪整个 topic -> script 主链路。
        </p>
        <p class="home-flow">选题 -> 确认 -> 生成文案</p>
      </div>

      <section class="home-capability-panel">
        <h2>正式工作区能力</h2>
        <ul data-testid="home-capability-list" class="home-capability-list">
          <li>Topic 候选历史可回看、可从任意轮确认</li>
          <li>Script 运行追踪与当前版本状态同步展示</li>
          <li>项目级 trace、run、step 信息统一归档</li>
        </ul>
      </section>
    </div>

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
  gap: 1.25rem;
  max-width: 64rem;
}

.home-kicker {
  margin: 0;
  color: #7c4d12;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.home-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(16rem, 1fr);
  gap: 1rem;
}

.home-copy,
.home-capability-panel {
  display: grid;
  gap: 0.75rem;
}

.home-capability-panel {
  padding: 1rem;
  border: 1px solid #d7ccc8;
  background: #fff8f2;
}

.home-capability-panel h2 {
  margin: 0;
  font-size: 1rem;
}

.home-capability-list {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.5rem;
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

@media (max-width: 720px) {
  .home-hero {
    grid-template-columns: 1fr;
  }
}
</style>
