<template>
  <section class="home-page workspace-shell">
    <div class="home-backdrop" />

    <section data-testid="home-hero" class="home-hero workspace-panel workspace-panel--strong">
      <div class="home-copy">
        <p data-testid="home-kicker" class="home-kicker">项目驱动 Topic + Script</p>
        <h1 data-testid="home-heading">Story Video Forge</h1>
        <p class="home-summary">
          把选题和文案工作区收拢到项目内，从新建项目开始追踪整个 topic -> script 主链路。
        </p>
        <p class="home-flow">选题 -> 确认 -> 生成文案</p>

        <div class="home-actions">
          <RouterLink data-testid="home-primary-cta" class="home-link home-link-primary" to="/projects">
            进入我的项目
          </RouterLink>
          <RouterLink data-testid="home-secondary-cta" class="home-link home-link-secondary" to="/projects">
            新建项目
          </RouterLink>
        </div>
      </div>

      <section
        data-testid="home-capability-section"
        class="home-capability-panel workspace-panel"
      >
        <span class="workspace-badge">Workspace</span>
        <h2>正式工作区能力</h2>
        <ul data-testid="home-capability-list" class="home-capability-list">
          <li class="home-capability-card">
            <strong>Topic 候选历史</strong>
            <span>支持多轮回看，并可从任意轮直接确认。</span>
          </li>
          <li class="home-capability-card">
            <strong>Script 运行追踪</strong>
            <span>当前版本、审校结论与动作闭环同步呈现。</span>
          </li>
          <li class="home-capability-card">
            <strong>项目级归档</strong>
            <span>项目级 trace、run、step 信息集中归档。</span>
          </li>
        </ul>
      </section>
    </section>

    <section
      data-testid="home-flow-strip"
      class="home-flow-strip workspace-panel"
      aria-label="产品主链路"
    >
      <div class="home-flow-step">
        <span class="home-flow-index">01</span>
        <strong>新建项目</strong>
      </div>
      <div class="home-flow-step">
        <span class="home-flow-index">02</span>
        <strong>生成选题</strong>
      </div>
      <div class="home-flow-step">
        <span class="home-flow-index">03</span>
        <strong>确认主题</strong>
      </div>
      <div class="home-flow-step">
        <span class="home-flow-index">04</span>
        <strong>生成文案</strong>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<style scoped>
.home-page {
  position: relative;
  display: grid;
  gap: 1.5rem;
  max-width: 76rem;
  margin: 0 auto;
}

.home-backdrop {
  position: absolute;
  inset: 2rem 0 auto;
  height: 18rem;
  pointer-events: none;
  background:
    radial-gradient(circle at left top, rgba(212, 163, 95, 0.18), transparent 46%),
    radial-gradient(circle at right top, rgba(197, 107, 71, 0.16), transparent 28%);
  filter: blur(18px);
}

.home-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(16rem, 1fr);
  gap: 1.5rem;
  padding: clamp(1.5rem, 3vw, 2.5rem);
  overflow: hidden;
}

.home-copy {
  display: grid;
  gap: 1rem;
  align-content: start;
}

.home-kicker {
  margin: 0;
  color: var(--workspace-accent);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.home-copy h1,
.home-capability-panel h2 {
  margin: 0;
}

.home-copy h1 {
  font-size: clamp(2.8rem, 6vw, 4.8rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
  text-wrap: balance;
  background: linear-gradient(135deg, #fff5dc 0%, #d8a562 52%, #c56b47 100%);
  -webkit-text-fill-color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
}

.home-capability-panel {
  display: grid;
  gap: 1rem;
  align-content: start;
  padding: 1.25rem;
}

.home-summary,
.home-flow {
  margin: 0;
}

.home-summary {
  max-width: 38rem;
  color: var(--workspace-text-muted);
  font-size: 1.05rem;
  line-height: 1.75;
}

.home-flow {
  color: var(--workspace-text);
  font-size: 1rem;
}

.home-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 10rem;
  min-height: 3rem;
  padding: 0.8rem 1.35rem;
  border: 1px solid var(--workspace-border);
  border-radius: 999px;
  text-decoration: none;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease;
}

.home-link:hover {
  transform: translateY(-1px);
  border-color: var(--workspace-border-strong);
}

.home-link-primary {
  background: linear-gradient(135deg, rgba(212, 163, 95, 0.3), rgba(197, 107, 71, 0.38));
}

.home-link-secondary {
  background: rgba(20, 27, 42, 0.72);
}

.home-capability-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.home-capability-card {
  display: grid;
  gap: 0.3rem;
  padding: 0.95rem 1rem;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 1rem;
  background: rgba(8, 12, 21, 0.56);
}

.home-capability-card strong {
  color: var(--workspace-text);
}

.home-capability-card span {
  color: var(--workspace-text-muted);
  line-height: 1.6;
}

.home-flow-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 1rem;
}

.home-flow-step {
  display: grid;
  gap: 0.45rem;
  padding: 1rem;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 1rem;
  background: rgba(10, 15, 24, 0.52);
}

.home-flow-index {
  color: var(--workspace-accent);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
}

@media (max-width: 720px) {
  .home-hero {
    grid-template-columns: 1fr;
  }

  .home-flow-strip {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .home-flow-strip {
    grid-template-columns: 1fr;
  }
}
</style>
