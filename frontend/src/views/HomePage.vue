<template>
  <section class="landing-page">
    <section data-testid="home-hero" class="hero">
      <div class="hero-bg-pattern" />

      <div class="hero-content">
        <p data-testid="home-kicker" class="home-kicker">项目驱动 Topic + Script</p>

        <h1 data-testid="home-heading" class="hero-title">
          <span class="hero-icon">🏛️</span>
          <span>Story Video </span>
          <span class="text-accent">Forge</span>
        </h1>

        <p data-testid="home-tagline" class="hero-tagline">历史叙事短视频工作台</p>

        <p class="home-summary hero-desc">
          从项目创建开始，先完成选题生成与确认，再进入文案生成和审阅，把当前阶段的主链路集中在一个入口里。
        </p>

        <div class="hero-actions">
          <RouterLink data-testid="home-primary-cta" to="/projects" class="btn btn-primary btn-lg">
            进入我的项目
          </RouterLink>
          <RouterLink
            data-testid="home-secondary-cta"
            to="/projects"
            class="btn btn-secondary btn-lg"
          >
            新建项目
          </RouterLink>
        </div>

        <div data-testid="home-feature-rail" class="hero-features">
          <div class="feature-item">
            <span class="feature-icon">📁</span>
            <span>项目驱动</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✨</span>
            <span>选题生成</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">🧭</span>
            <span>多轮确认</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">📝</span>
            <span>文案生成</span>
          </div>
        </div>

        <p data-testid="home-flow-strip" class="home-flow-strip">
          当前阶段聚焦 Topic 与 Script，不引入 storyboard、assets、compose。
        </p>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<style scoped>
.landing-page {
  min-height: 100vh;
}

.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  padding: 2rem 1.5rem;
}

.hero-bg-pattern {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 20% 50%, rgba(192, 57, 43, 0.08) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(212, 165, 116, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 80%, rgba(44, 62, 80, 0.1) 0%, transparent 50%);
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 760px;
  padding: 2.5rem;
}

.home-kicker {
  margin-bottom: 1rem;
  color: var(--workspace-accent);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.hero-title {
  font-size: clamp(3rem, 8vw, 4.8rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  color: #fff2d8;
}

.hero-icon {
  font-size: clamp(2.6rem, 7vw, 3.6rem);
}

.text-accent {
  background: linear-gradient(135deg, var(--workspace-accent), #e48c5c);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-tagline {
  margin: 0 0 1rem;
  font-size: clamp(1.25rem, 3vw, 1.7rem);
  color: var(--workspace-text-muted);
}

.hero-desc {
  margin: 0 auto 1.75rem;
  max-width: 42rem;
  font-size: 1.12rem;
  color: #c9bea9;
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-bottom: 2rem;
}

.btn {
  min-width: 10.5rem;
  text-decoration: none;
}

.hero-features {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.feature-item {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--workspace-text-muted);
  font-size: 0.95rem;
}

.feature-icon {
  font-size: 1.1rem;
}

.home-flow-strip {
  margin: 0;
  color: #aa9e87;
  font-size: 0.95rem;
  line-height: 1.7;
}

@media (max-width: 768px) {
  .hero-content {
    padding: 1.25rem;
  }

  .hero-features {
    gap: 1rem;
  }
}
</style>
