<template>
  <section class="home-page">
    <!-- Hero -->
    <section data-testid="home-hero" class="hero">
      <div class="hero-bg-pattern" />

      <div class="hero-content">
        <h1 data-testid="home-heading" class="hero-title">
          <span>Story Video </span>
          <span class="title-accent">Forge</span>
        </h1>

        <p data-testid="home-tagline" class="hero-tagline">
          历史叙事短视频工作台
        </p>

        <p class="hero-desc">
          从选题到成片，六大阶段一键贯通。选题、文案、分镜、资产规划、资产、合成、渲染导出，全流程集中在一个工作台里。
        </p>

        <div class="hero-actions">
          <el-button
            data-testid="home-primary-cta"
            type="primary"
            size="large"
            @click="router.push('/projects')"
          >
            我的项目
          </el-button>
          <el-button
            data-testid="home-secondary-cta"
            size="large"
            @click="handleCreateProject"
          >
            新建项目
          </el-button>
        </div>
      </div>
    </section>

    <!-- Pipeline Feature Cards -->
    <section data-testid="home-feature-rail" class="pipeline-section">
      <h2 class="section-title">创作流水线</h2>
      <p class="section-subtitle">从选题到成片，六大阶段一键贯通</p>

      <el-row :gutter="20" class="pipeline-cards" justify="center">
        <el-col
          v-for="(step, index) in pipelineSteps"
          :key="step.key"
          :xs="12"
          :sm="8"
          :md="8"
          :lg="4"
        >
          <el-card
            shadow="hover"
            class="pipeline-card"
            :body-style="{ padding: 'var(--space-lg) var(--space-md)' }"
          >
            <div class="card-step-number">{{ index + 1 }}</div>
            <div class="card-icon">{{ step.icon }}</div>
            <div class="card-label">{{ step.label }}</div>
          </el-card>
        </el-col>
      </el-row>
    </section>

    <!-- Footer hint -->
    <p data-testid="home-flow-strip" class="flow-strip">
      从选题生成到视频渲染导出，全流程一站式完成。
    </p>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";

import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();

const pipelineSteps = [
  { key: "topic", icon: "💡", label: "选题" },
  { key: "script", icon: "📝", label: "文案" },
  { key: "storyboard", icon: "🎬", label: "分镜" },
  { key: "asset-planning", icon: "📋", label: "资产规划" },
  { key: "asset", icon: "🖼️", label: "资产" },
  { key: "compose", icon: "🎥", label: "合成" },
  { key: "render", icon: "📥", label: "渲染导出" },
];

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(
    projectStore.resolveProjectWorkspacePath(
      project.project_id,
      project.current_status,
    ),
  );
}
</script>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

/* ── Hero ── */
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  overflow: hidden;
  padding: var(--space-xl) var(--space-lg);
}

.hero-bg-pattern {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse at 20% 50%,
      color-mix(in srgb, var(--accent-primary) 8%, transparent) 0%,
      transparent 60%
    ),
    radial-gradient(
      ellipse at 80% 20%,
      color-mix(in srgb, var(--accent-primary-light) 6%, transparent) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse at 50% 80%,
      color-mix(in srgb, var(--bg-panel) 10%, transparent) 0%,
      transparent 50%
    );
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 760px;
}

.hero-title {
  font-size: clamp(2.8rem, 8vw, 4.8rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  margin-bottom: var(--space-md);
  color: var(--text-heading);
}

.title-accent {
  background: var(--accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-tagline {
  margin: 0 0 var(--space-md);
  font-size: clamp(1.25rem, 3vw, 1.7rem);
  color: var(--text-secondary);
}

.hero-desc {
  margin: 0 auto var(--space-lg);
  max-width: 42rem;
  font-size: 1.05rem;
  color: var(--text-secondary);
  line-height: 1.8;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.hero-actions .el-button--large {
  min-width: 140px;
  font-weight: 600;
}

/* ── Pipeline Section ── */
.pipeline-section {
  padding: var(--space-xl) var(--space-lg) var(--space-lg);
  text-align: center;
}

.section-title {
  font-size: clamp(1.4rem, 3vw, 1.8rem);
  font-weight: var(--font-heading);
  color: var(--text-heading);
  margin-bottom: var(--space-sm);
}

.section-subtitle {
  font-size: 1rem;
  color: var(--text-muted);
  margin-bottom: var(--space-xl);
}

.pipeline-cards {
  max-width: 960px;
  margin: 0 auto;
}

.pipeline-card {
  text-align: center;
  margin-bottom: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.pipeline-card:hover {
  border-color: var(--border-active);
  box-shadow: var(--shadow-elevated);
  transform: translateY(-2px);
}

.card-step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-inverse);
  background: var(--accent-gradient);
  margin-bottom: var(--space-sm);
}

.card-icon {
  font-size: 2rem;
  margin-bottom: var(--space-xs);
}

.card-label {
  font-size: 0.95rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

/* ── Flow strip ── */
.flow-strip {
  text-align: center;
  padding: var(--space-md) var(--space-lg) var(--space-xl);
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .hero {
    min-height: auto;
    padding: var(--space-xl) var(--space-md);
  }

  .pipeline-section {
    padding: var(--space-lg) var(--space-md) var(--space-md);
  }
}
</style>
