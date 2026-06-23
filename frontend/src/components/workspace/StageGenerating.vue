<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  title: string;
  hint: string;
  secondaryHint?: string;
}>();

const elapsedSeconds = ref(0);
let timer: ReturnType<typeof window.setInterval> | null = null;

const dots = computed(() => ".".repeat((elapsedSeconds.value % 3) + 1));

const titleText = computed(
  () => `${props.title}${dots.value}`,
);

onMounted(() => {
  timer = window.setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
});

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
});
</script>

<template>
  <section class="stage-generating" aria-live="polite">
    <div class="center-state-inner">
      <div class="center-pulse">✦</div>
      <h2 class="center-state-title">{{ titleText }}</h2>
      <p class="center-state-desc">{{ hint }}</p>
      <p v-if="secondaryHint" class="center-state-sub">生成完成后结果会自动出现，无需手动刷新。已等待 <b>{{ elapsedSeconds }}</b> 秒。</p>
      <div class="center-state-line"></div>
      <div v-if="$slots.action" class="center-state-actions">
        <slot name="action" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.stage-generating {
  min-height: calc(100vh - 72px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 28px 64px;
}

.center-state-inner {
  width: min(560px, 100%);
  text-align: center;
  transform: translateY(-80px);
}

.center-pulse {
  width: 88px;
  height: 88px;
  margin: 0 auto 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  color: #e4c26f;
  background:
    radial-gradient(circle at 50% 40%, rgba(201,162,39,.20), rgba(201,162,39,.065) 62%, rgba(201,162,39,.025) 100%);
  border: 1px solid rgba(201,162,39,.22);
  font-size: 34px;
  box-shadow:
    0 0 42px rgba(201,162,39,.08),
    inset 0 1px 0 rgba(255,255,255,.05);
}

.center-pulse::before,
.center-pulse::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(201,162,39,.25);
  inset: -8px;
  animation: pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite;
}

.center-pulse::after {
  inset: -18px;
  opacity: .34;
  animation-delay: .55s;
}

@keyframes pulse-ring {
  0%, 100% { opacity: .42; transform: scale(.96); }
  50% { opacity: .08; transform: scale(1.14); }
}

.center-state-title {
  color: #f5f0e8;
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 26px;
  line-height: 1.25;
  letter-spacing: -.02em;
  margin: 0 0 10px;
  font-weight: 700;
}

.center-state-desc {
  max-width: 520px;
  margin: 0 auto;
  color: #a89f94;
  font-size: 14px;
  line-height: 1.85;
}

.center-state-sub {
  margin-top: 6px;
  color: #6b635a;
  font-size: 13px;
}

.center-state-sub b {
  color: #d4a574;
  font-weight: 750;
}

.center-state-line {
  width: 150px;
  height: 1px;
  margin: 24px auto 0;
  background: linear-gradient(90deg, transparent, rgba(201,162,39,.24), transparent);
}

.center-state-actions {
  margin-top: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
</style>
