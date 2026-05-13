<script setup lang="ts">
import type {
  ArtBible,
  CostSummary,
} from "../../stores/asset-planning";

defineProps<{
  artBible: ArtBible | null | undefined;
  visualBudget: Record<string, unknown> | null | undefined;
  downgradePolicy: Record<string, unknown> | null | undefined;
  globalAudioStrategy: Record<string, unknown> | null | undefined;
  costSummary: CostSummary | null | undefined;
}>();
</script>

<template>
  <section data-testid="asset-plan-summary" class="asset-plan-summary">
    <h2>规划总览</h2>
    <div class="summary-grid">
      <!-- Art Bible -->
      <article data-testid="summary-art-bible" class="summary-card">
        <h3>Art Bible</h3>
        <dl v-if="artBible" class="summary-dl">
          <div class="summary-dl-row">
            <dt>时代风格</dt>
            <dd>{{ artBible.era_style ?? "-" }}</dd>
          </div>
          <div class="summary-dl-row">
            <dt>视觉基调</dt>
            <dd>{{ artBible.visual_tone ?? "-" }}</dd>
          </div>
          <div v-if="artBible.characters" class="summary-dl-row">
            <dt>角色</dt>
            <dd>{{ Array.isArray(artBible.characters) ? artBible.characters.length : 0 }} 项</dd>
          </div>
          <div v-if="artBible.locations" class="summary-dl-row">
            <dt>场景</dt>
            <dd>{{ Array.isArray(artBible.locations) ? artBible.locations.length : 0 }} 项</dd>
          </div>
          <div v-if="artBible.props" class="summary-dl-row">
            <dt>道具</dt>
            <dd>{{ Array.isArray(artBible.props) ? artBible.props.length : 0 }} 项</dd>
          </div>
        </dl>
        <p v-else class="summary-empty">暂无数据</p>
      </article>

      <!-- Visual Budget -->
      <article data-testid="summary-visual-budget" class="summary-card">
        <h3>视觉预算</h3>
        <dl v-if="visualBudget && Object.keys(visualBudget).length > 0" class="summary-dl">
          <div
            v-for="(value, key) in visualBudget"
            :key="key"
            class="summary-dl-row"
          >
            <dt>{{ key }}</dt>
            <dd>{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
          </div>
        </dl>
        <p v-else class="summary-empty">暂无数据</p>
      </article>

      <!-- Downgrade Policy -->
      <article data-testid="summary-downgrade-policy" class="summary-card">
        <h3>降级策略</h3>
        <dl v-if="downgradePolicy && Object.keys(downgradePolicy).length > 0" class="summary-dl">
          <div
            v-for="(value, key) in downgradePolicy"
            :key="key"
            class="summary-dl-row"
          >
            <dt>{{ key }}</dt>
            <dd>{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
          </div>
        </dl>
        <p v-else class="summary-empty">暂无数据</p>
      </article>

      <!-- Global Audio Strategy -->
      <article data-testid="summary-audio-strategy" class="summary-card">
        <h3>音频策略</h3>
        <dl v-if="globalAudioStrategy && Object.keys(globalAudioStrategy).length > 0" class="summary-dl">
          <div
            v-for="(value, key) in globalAudioStrategy"
            :key="key"
            class="summary-dl-row"
          >
            <dt>{{ key }}</dt>
            <dd>{{ typeof value === "object" ? JSON.stringify(value) : value }}</dd>
          </div>
        </dl>
        <p v-else class="summary-empty">暂无数据</p>
      </article>

      <!-- Cost Summary -->
      <article data-testid="summary-cost" class="summary-card summary-card--wide">
        <h3>成本摘要</h3>
        <dl v-if="costSummary" class="summary-dl">
          <div class="summary-dl-row">
            <dt>总任务数</dt>
            <dd>{{ costSummary.total_tasks ?? "-" }}</dd>
          </div>
          <div v-if="costSummary.estimated_provider_calls != null" class="summary-dl-row">
            <dt>预估调用次数</dt>
            <dd>{{ costSummary.estimated_provider_calls }}</dd>
          </div>
          <div v-if="costSummary.by_type" class="summary-dl-row summary-dl-row--block">
            <dt>按类型</dt>
            <dd>
              <span
                v-for="(count, type) in costSummary.by_type"
                :key="type"
                class="summary-badge"
              >{{ type }}: {{ count }}</span>
            </dd>
          </div>
          <div v-if="costSummary.by_cost_tier" class="summary-dl-row summary-dl-row--block">
            <dt>按成本档位</dt>
            <dd>
              <span
                v-for="(count, tier) in costSummary.by_cost_tier"
                :key="tier"
                class="summary-badge"
              >{{ tier }}: {{ count }}</span>
            </dd>
          </div>
        </dl>
        <p v-else class="summary-empty">暂无数据</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.asset-plan-summary {
  display: grid;
  gap: 1rem;
}

.asset-plan-summary h2 {
  margin: 0;
  font-size: 1.2rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.summary-card {
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.5rem;
}

.summary-card--wide {
  grid-column: 1 / -1;
}

.summary-card h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--workspace-accent);
}

.summary-dl {
  display: grid;
  gap: 0.4rem;
  margin: 0;
}

.summary-dl-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75rem;
  align-items: baseline;
}

.summary-dl-row--block {
  grid-template-columns: auto 1fr;
}

.summary-dl-row dt {
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
  white-space: nowrap;
}

.summary-dl-row dd {
  margin: 0;
  font-size: 0.92rem;
  color: var(--workspace-text);
  word-break: break-word;
}

.summary-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0.15rem 0.55rem;
  margin: 0.15rem;
  border: 1px solid var(--workspace-border);
  border-radius: 6px;
  background: rgba(212, 163, 95, 0.08);
  color: var(--workspace-text-muted);
  font-size: 0.82rem;
}

.summary-empty {
  margin: 0;
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}
</style>
