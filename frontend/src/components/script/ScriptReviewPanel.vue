<script setup lang="ts">
const stageLabels: Record<string, string> = {
  local_validation: "本地校验",
  semantic_review: "语义审校",
  pending: "待审校",
  in_progress: "进行中",
  completed: "已完成",
};

const decisionLabels: Record<string, string> = {
  pass: "通过",
  fail: "未通过",
  pending: "待定",
  patch_once: "需修订",
  regen_once: "需重写",
  return_topic: "需返回选题",
};

const patchIntentLabels: Record<string, string> = {
  fix: "修正问题",
  lift: "提升质量",
};

defineProps<{
  activeScript: {
    review_decision: "pass" | "patch_once" | "regen_once" | "return_topic";
    patch_intent: "fix" | "lift" | null;
    local_validation: {
      stage: string;
      decision: string;
    };
    semantic_review: {
      stage: string;
      decision: string;
      patch_intent: "fix" | "lift" | null;
    };
    execution_state: {
      patch_used: boolean;
      regenerate_used: boolean;
    };
  };
  isRunningAction: boolean;
}>();

defineEmits<{
  patchOnce: [];
  regenOnce: [];
}>();
</script>

<template>
  <section class="script-review-panel">
    <h2>校验与审校</h2>
    <p data-testid="local-validation">
      本地校验：
      <span class="workspace-badge">{{ stageLabels[activeScript.local_validation.stage] ?? activeScript.local_validation.stage }}</span>
      <span :class="activeScript.local_validation.decision === 'pass' ? 'review-pass' : 'review-fail'">
        {{ decisionLabels[activeScript.local_validation.decision] ?? activeScript.local_validation.decision }}
      </span>
    </p>
    <p data-testid="semantic-review">
      语义审校：
      <span class="workspace-badge">{{ stageLabels[activeScript.semantic_review.stage] ?? activeScript.semantic_review.stage }}</span>
      <span :class="activeScript.semantic_review.decision === 'pass' ? 'review-pass' : 'review-fail'">
        {{ decisionLabels[activeScript.semantic_review.decision] ?? activeScript.semantic_review.decision }}
      </span>
      <span v-if="activeScript.semantic_review.patch_intent" class="review-patch-intent">
        修订方向：{{ patchIntentLabels[activeScript.semantic_review.patch_intent] ?? activeScript.semantic_review.patch_intent }}
      </span>
    </p>

    <button
      v-if="
        activeScript.review_decision === 'patch_once' &&
        !activeScript.execution_state.patch_used
      "
      data-testid="patch-once"
      type="button"
      class="btn btn-secondary"
      :disabled="isRunningAction"
      @click="$emit('patchOnce')"
    >
      {{ isRunningAction ? "修订中…" : "修订文案" }}
    </button>

    <button
      v-if="
        activeScript.review_decision !== 'return_topic' &&
        !activeScript.execution_state.regenerate_used
      "
      data-testid="regen-once"
      type="button"
      class="btn btn-secondary"
      :disabled="isRunningAction"
      @click="$emit('regenOnce')"
    >
      {{ isRunningAction ? "重写中…" : "重新生成" }}
    </button>
  </section>
</template>

<style scoped>
.script-review-panel {
  display: grid;
  gap: 0.5rem;
}

.review-pass {
  color: #2ecc71;
}

.review-fail {
  color: var(--workspace-accent-strong, #c0392b);
}

.review-patch-intent {
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}
</style>
