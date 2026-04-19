<script setup lang="ts">
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
      {{ activeScript.local_validation.stage }} / {{ activeScript.local_validation.decision }}
    </p>
    <p data-testid="semantic-review">
      {{ activeScript.semantic_review.stage }} / {{ activeScript.semantic_review.decision }}
      <span v-if="activeScript.patch_intent"> / {{ activeScript.patch_intent }}</span>
    </p>

    <button
      v-if="
        activeScript.review_decision === 'patch_once' &&
        !activeScript.execution_state.patch_used
      "
      data-testid="patch-once"
      type="button"
      :disabled="isRunningAction"
      @click="$emit('patchOnce')"
    >
      {{ isRunningAction ? "patch_once..." : "触发 patch_once" }}
    </button>

    <button
      v-if="
        activeScript.review_decision === 'regen_once' &&
        !activeScript.execution_state.regenerate_used
      "
      data-testid="regen-once"
      type="button"
      :disabled="isRunningAction"
      @click="$emit('regenOnce')"
    >
      {{ isRunningAction ? "regen_once..." : "触发 regen_once" }}
    </button>
  </section>
</template>
