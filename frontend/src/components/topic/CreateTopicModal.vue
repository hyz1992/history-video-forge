<script setup lang="ts">
import { Close, Lightning } from "@element-plus/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";

import {
  TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH,
  TOPIC_RECOMMENDATION_PERIOD_GROUPS,
  type TopicRecommendationCentralActorType,
  type TopicRecommendationEventDomain,
  type TopicRecommendationPeriodId,
  type TopicRecommendationStorytellingLens,
} from "../../../../shared/src";
import { useProjectStore } from "../../stores/project";
import {
  loadTopicRecommendationFilterDraft,
  saveTopicRecommendationFilterDraft,
  useTopicStore,
  type TopicRecommendationEraBand,
  type TopicRecommendationFilterDraft,
  type TopicTab,
} from "../../stores/topic";
import { useGenerationCostStore } from "../../stores/generation-cost";
import CustomTopicInput from "../event-library/CustomTopicInput.vue";
import NarrationCreationSelection from "./NarrationCreationSelection.vue";
import { NarrationCreationCancelled, useNarrationProjectCreation } from "../../composables/useNarrationProjectCreation";
import EventLibraryBrowser from "../event-library/EventLibraryBrowser.vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "confirmed"): void;
}>();

const projectStore = useProjectStore();
const topicStore = useTopicStore();

// 任务11C：统一创建协调（422 资格不合格时原地等待选择，取消/关闭零创建）。
const { pendingSelection, waiting, createOrAwait, confirmSelection, cancelSelection } = useNarrationProjectCreation((input) => projectStore.createProject(input));
function coordinatedCreate(input?: { name?: string }) {
  return createOrAwait(input);
}
const costStore = useGenerationCostStore();

watch(() => props.visible, (visible) => {
  // 任务11C：弹窗关闭即取消待续创建（零创建不续发的兜底）。
  if (!visible) cancelSelection();
});

const activeTab = ref<TopicTab>("system");
const isGenerating = ref(false);
const excludeInput = ref("");
const isExcludeComposing = ref(false);
const error = ref<string | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const activeRangeHandle = ref<"start" | "end">("end");
let previouslyFocusedElement: HTMLElement | null = null;

const eraOptions: Array<{ value: TopicRecommendationEraBand; label: string }> = [
  { value: "unlimited", label: "不限" },
  { value: "ancient", label: "先秦至两汉" },
  { value: "medieval", label: "魏晋至唐宋" },
  { value: "late_imperial", label: "元明清" },
];
const lensOptions: Array<{
  value: TopicRecommendationFilterDraft["storytelling_lens"];
  label: string;
}> = [
  { value: "auto", label: "系统判断" },
  { value: "key_decision", label: "关键决策" },
  { value: "relationship_dynamics", label: "人物博弈" },
  { value: "turning_point", label: "局势转折" },
  { value: "origins_analysis", label: "因果拆解" },
  { value: "aftermath", label: "后果追踪" },
];
const eventOptions: Array<{ value: TopicRecommendationEventDomain; label: string }> = [
  { value: "political_power", label: "政治权力" },
  { value: "military_warfare", label: "军事战争" },
  { value: "institutions_governance", label: "制度治理" },
  { value: "diplomacy_relations", label: "外交交涉" },
  { value: "law_justice", label: "法律司法" },
  { value: "society_livelihood", label: "社会民生" },
  { value: "thought_culture", label: "思想文化" },
];
const actorOptions: Array<{ value: TopicRecommendationCentralActorType; label: string }> = [
  { value: "ruler", label: "帝王君主" },
  { value: "court_elite", label: "宫廷权贵" },
  { value: "civil_official", label: "文官政务" },
  { value: "military_actor", label: "军事人物" },
  { value: "intellectual_actor", label: "学者思想家" },
  { value: "religious_actor", label: "宗教人物" },
  { value: "civilian", label: "民间人物" },
  { value: "collective", label: "群体多方" },
];
const tabOptions: Array<{ value: TopicTab; label: string }> = [
  { value: "system", label: "系统推荐" },
  { value: "library", label: "事件库" },
  { value: "custom", label: "自定义选题" },
];
const draft = reactive<TopicRecommendationFilterDraft>(
  loadTopicRecommendationFilterDraft(),
);
const isAdvancedOpen = ref(
  draft.event_domain !== "unlimited" ||
  draft.central_actor_type !== "unlimited" ||
  draft.exclude_terms.length > 0,
);

const currentPeriodGroup = computed(() =>
  TOPIC_RECOMMENDATION_PERIOD_GROUPS.find((group) => group.id === draft.era_band),
);
const currentPeriods = computed(() => currentPeriodGroup.value?.periods ?? []);
const startIndex = computed(() => Math.max(
  0,
  currentPeriods.value.findIndex((period) => period.id === draft.period_start_id),
));
const endIndex = computed(() => {
  const index = currentPeriods.value.findIndex((period) => period.id === draft.period_end_id);
  return index < 0 ? Math.max(currentPeriods.value.length - 1, 0) : index;
});
const selectedPeriods = computed(() =>
  currentPeriods.value.slice(startIndex.value, endIndex.value + 1),
);
const periodSummary = computed(() =>
  `已选：${selectedPeriods.value.map((period) => period.label).join("、")}`,
);
const periodStyle = computed(() => {
  const lastIndex = Math.max(currentPeriods.value.length - 1, 1);
  const left = (startIndex.value / lastIndex) * 100;
  const width = ((endIndex.value - startIndex.value) / lastIndex) * 100;
  return {
    "--period-count": currentPeriods.value.length,
    "--range-left": `${left}%`,
    "--range-width": `${width}%`,
  };
});
const frontRangeHandle = computed<"start" | "end">(() => {
  if (startIndex.value !== endIndex.value) return activeRangeHandle.value;
  if (startIndex.value === currentPeriods.value.length - 1) return "start";
  if (startIndex.value === 0) return "end";
  return activeRangeHandle.value;
});
const startValueText = computed(() =>
  `起点：${currentPeriods.value[startIndex.value]?.label ?? "不限"}`,
);
const endValueText = computed(() =>
  `终点：${currentPeriods.value[endIndex.value]?.label ?? "不限"}`,
);

function selectEra(era: TopicRecommendationEraBand) {
  if (isGenerating.value) return;
  draft.era_band = era;
  if (era === "unlimited") {
    draft.period_start_id = null;
    draft.period_end_id = null;
    return;
  }
  const group = TOPIC_RECOMMENDATION_PERIOD_GROUPS.find((item) => item.id === era)!;
  draft.period_start_id = group.periods[0].id;
  draft.period_end_id = group.periods[group.periods.length - 1].id;
}

function updateStart(event: Event) {
  if (isGenerating.value) return;
  activeRangeHandle.value = "start";
  const value = Math.min(Number((event.target as HTMLInputElement).value), endIndex.value);
  draft.period_start_id = currentPeriods.value[value]?.id ?? null;
}

function updateEnd(event: Event) {
  if (isGenerating.value) return;
  activeRangeHandle.value = "end";
  const value = Math.max(Number((event.target as HTMLInputElement).value), startIndex.value);
  draft.period_end_id = currentPeriods.value[value]?.id ?? null;
}

function normalizeExcludeTerms(values: unknown[]) {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.slice(0, TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH)),
  )].slice(0, 8);
}

function addExcludeTerm() {
  if (isGenerating.value || isExcludeComposing.value) return;
  const value = excludeInput.value.trim().slice(0, TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH);
  if (value && draft.exclude_terms.length < 8 && !draft.exclude_terms.includes(value)) {
    draft.exclude_terms.push(value);
  }
  excludeInput.value = "";
}

function removeExcludeTerm(index: number) {
  if (isGenerating.value) return;
  draft.exclude_terms.splice(index, 1);
}

function handleExcludeEnter(event: KeyboardEvent) {
  if (event.isComposing || isExcludeComposing.value) return;
  event.preventDefault();
  addExcludeTerm();
}

function selectLens(value: TopicRecommendationFilterDraft["storytelling_lens"]) {
  if (!isGenerating.value) draft.storytelling_lens = value;
}

function selectEventDomain(value: TopicRecommendationFilterDraft["event_domain"]) {
  if (!isGenerating.value) draft.event_domain = value;
}

function selectActorType(value: TopicRecommendationFilterDraft["central_actor_type"]) {
  if (!isGenerating.value) draft.central_actor_type = value;
}

function toggleAdvanced() {
  if (!isGenerating.value) isAdvancedOpen.value = !isAdvancedOpen.value;
}

function saveDraft() {
  return saveTopicRecommendationFilterDraft({
    ...draft,
    exclude_terms: normalizeExcludeTerms(draft.exclude_terms),
  });
}

async function handleGenerate() {
  if (isGenerating.value) return;
  isGenerating.value = true;
  error.value = null;
  const snapshot = saveDraft();
  try {
    // 任务11C：经协调创建（422 时原地等待选择），取消则不触发生成。
    await coordinatedCreate();
    topicStore.selectTab(activeTab.value);
    // 2026-08-23 修复回归：创建项目后不等待 LLM 生成完成——立即关闭弹窗
    // 进入项目页（topic 阶段显示生成中 loading，由轮询驱动）。S2-2D 报价
    // 时代改为 await 导致用户长时间停留在"创建中…"按钮。
    void topicStore.generateSystemRecommendations(snapshot);
    emit("confirmed");
  } catch (caught) {
    if (caught instanceof NarrationCreationCancelled) return;
    error.value = caught instanceof Error ? caught.message : "创建项目失败，请重试";
  } finally {
    isGenerating.value = false;
  }
}

function close() {
  // 任务11C：等待选择期间禁止关闭（取消须经选择面板，保证零创建不续发）。
  if (!isGenerating.value && !waiting.value) emit("update:visible", false);
}

function getFocusableElements() {
  if (!dialogRef.value) return [];
  return Array.from(dialogRef.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("hidden"));
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = getFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    dialogRef.value?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function focusDialog() {
  await nextTick();
  closeButtonRef.value?.focus();
  if (document.activeElement !== closeButtonRef.value) dialogRef.value?.focus();
}

function restorePreviousFocus() {
  if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
  previouslyFocusedElement = null;
}

function onChildClose() {
  emit("confirmed");
  emit("update:visible", false);
}

watch(() => props.visible, (visible) => {
  if (visible) {
    previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    void focusDialog();
  } else {
    error.value = null;
    activeTab.value = "system";
    restorePreviousFocus();
  }
});

onMounted(() => {
  if (!props.visible) return;
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  void focusDialog();
});

onBeforeUnmount(restorePreviousFocus);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay">
      <section
        ref="dialogRef"
        class="modal-box"
        data-testid="topic-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-topic-title"
        tabindex="-1"
        @keydown="handleDialogKeydown"
      >
        <button
          ref="closeButtonRef"
          class="modal-close"
          data-testid="modal-close"
          aria-label="关闭"
          :disabled="isGenerating"
          :aria-disabled="isGenerating"
          @click="close"
        >
          <Close />
        </button>
        <h2 id="create-topic-title" class="modal-title">新建项目</h2>
        <nav class="modal-tabs" aria-label="选题来源">
          <button
            v-for="tab in tabOptions"
            :key="tab.value"
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === tab.value }"
            :disabled="isGenerating || waiting"
            :aria-disabled="isGenerating || waiting"
            :aria-pressed="activeTab === tab.value"
            @click="activeTab = tab.value"
          >{{ tab.label }}</button>
        </nav>

        <section v-if="activeTab === 'system'" class="modal-filters" aria-label="推荐筛选">
          <div class="basic-grid">
            <div class="filter-group filter-group--timeline">
              <div class="filter-label">时代范围</div>
              <div class="chip-row">
                <button
                  v-for="option in eraOptions"
                  :key="option.value"
                  class="chip"
                  :class="{ 'chip--active': draft.era_band === option.value }"
                  :disabled="isGenerating"
                  :aria-disabled="isGenerating"
                  :aria-pressed="draft.era_band === option.value"
                  @click="selectEra(option.value)"
                >{{ option.label }}</button>
              </div>

              <div v-if="draft.era_band !== 'unlimited'" class="child-filter" data-testid="period-range">
                <div class="filter-head">
                  <div class="child-label">历史区间 <span>随时代范围变化</span></div>
                  <div class="period-selection" data-testid="period-summary">{{ periodSummary }}</div>
                </div>
                <div class="period-range-scroll">
                  <div class="period-range" :style="periodStyle">
                    <div class="period-track-shell">
                      <div class="period-track"></div>
                      <div class="period-track-active"></div>
                      <input
                        class="period-slider period-slider--start"
                        :class="{ 'period-slider--front': frontRangeHandle === 'start' }"
                        data-testid="period-start"
                        type="range"
                        min="0"
                        :max="Math.max(currentPeriods.length - 1, 0)"
                        :value="startIndex"
                        :disabled="isGenerating"
                        :aria-disabled="isGenerating"
                        aria-label="历史区间起点"
                        :aria-valuetext="startValueText"
                        @input="updateStart"
                      >
                      <input
                        class="period-slider period-slider--end"
                        :class="{ 'period-slider--front': frontRangeHandle === 'end' }"
                        data-testid="period-end"
                        type="range"
                        min="0"
                        :max="Math.max(currentPeriods.length - 1, 0)"
                        :value="endIndex"
                        :disabled="isGenerating"
                        :aria-disabled="isGenerating"
                        aria-label="历史区间终点"
                        :aria-valuetext="endValueText"
                        @input="updateEnd"
                      >
                    </div>
                    <div class="period-marks">
                      <div
                        v-for="(period, index) in currentPeriods"
                        :key="period.id"
                        class="period-mark"
                        :class="{ 'period-mark--active': index >= startIndex && index <= endIndex }"
                      >{{ period.label }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="filter-group">
              <div class="filter-label">讲述视角</div>
              <div class="chip-row lens-row">
                <button
                  v-for="option in lensOptions"
                  :key="option.value"
                  class="chip"
                  :class="{ 'chip--active': draft.storytelling_lens === option.value }"
                  :disabled="isGenerating"
                  :aria-disabled="isGenerating"
                  :aria-pressed="draft.storytelling_lens === option.value"
                  @click="selectLens(option.value)"
                >{{ option.label }}</button>
              </div>
            </div>
          </div>

          <div class="advanced-toggle">
            <div class="advanced-head">
              <span class="advanced-title">更多筛选</span>
              <button
                class="advanced-action"
                data-testid="advanced-toggle"
                type="button"
                :disabled="isGenerating"
                :aria-disabled="isGenerating"
                :aria-expanded="isAdvancedOpen"
                @click="toggleAdvanced"
              >
                {{ isAdvancedOpen ? '收起筛选' : '展开筛选' }}
              </button>
            </div>
            <div v-if="isAdvancedOpen" class="advanced-panel">
              <div class="filter-mini">
                <div class="filter-label">事件领域</div>
                <div class="option-grid">
                  <button
                    class="chip chip--small"
                    data-testid="event-unlimited"
                    :class="{ 'chip--active': draft.event_domain === 'unlimited' }"
                    :disabled="isGenerating"
                    :aria-disabled="isGenerating"
                    :aria-pressed="draft.event_domain === 'unlimited'"
                    @click="selectEventDomain('unlimited')"
                  >不限</button>
                  <button
                    v-for="option in eventOptions"
                    :key="option.value"
                    class="chip chip--small"
                    :class="{ 'chip--active': draft.event_domain === option.value }"
                    :disabled="isGenerating"
                    :aria-disabled="isGenerating"
                    :aria-pressed="draft.event_domain === option.value"
                    @click="selectEventDomain(option.value)"
                  >{{ option.label }}</button>
                </div>
              </div>
              <div class="filter-mini">
                <div class="filter-label">中心行动者</div>
                <div class="option-grid">
                  <button
                    class="chip chip--small"
                    data-testid="actor-unlimited"
                    :class="{ 'chip--active': draft.central_actor_type === 'unlimited' }"
                    :disabled="isGenerating"
                    :aria-disabled="isGenerating"
                    :aria-pressed="draft.central_actor_type === 'unlimited'"
                    @click="selectActorType('unlimited')"
                  >不限</button>
                  <button
                    v-for="option in actorOptions"
                    :key="option.value"
                    class="chip chip--small"
                    :class="{ 'chip--active': draft.central_actor_type === option.value }"
                    :disabled="isGenerating"
                    :aria-disabled="isGenerating"
                    :aria-pressed="draft.central_actor_type === option.value"
                    @click="selectActorType(option.value)"
                  >{{ option.label }}</button>
                </div>
              </div>
              <div class="filter-mini filter-mini--exclude">
                <div class="filter-head filter-head--compact">
                  <div class="filter-label">排除项</div>
                  <span class="filter-count">{{ draft.exclude_terms.length }}/8</span>
                </div>
                <div class="tag-input">
                  <span v-for="(term, index) in draft.exclude_terms" :key="term" class="tag tag--bounded" data-testid="exclude-tag">
                    <span class="tag-text" data-testid="exclude-tag-text" :title="term">{{ term }}</span>
                    <button
                      data-testid="remove-exclude"
                      :aria-label="`删除排除项 ${term}`"
                      :title="`删除 ${term}`"
                      :disabled="isGenerating"
                      :aria-disabled="isGenerating"
                      @click="removeExcludeTerm(index)"
                    >
                      <Close />
                    </button>
                  </span>
                  <input
                    v-model="excludeInput"
                    data-testid="exclude-input"
                    :maxlength="TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH"
                    :disabled="isGenerating || draft.exclude_terms.length >= 8"
                    :aria-disabled="isGenerating || draft.exclude_terms.length >= 8"
                    placeholder="输入后回车"
                    @compositionstart="isExcludeComposing = true"
                    @compositionend="isExcludeComposing = false"
                    @keydown.enter="handleExcludeEnter"
                  >
                </div>
              </div>
            </div>
          </div>
        </section>

        <div v-else-if="activeTab === 'library'" class="modal-tab-content">
          <EventLibraryBrowser :create-project="coordinatedCreate" @close="onChildClose" />
        </div>
        <div v-else-if="activeTab === 'custom'" class="modal-tab-content">
          <CustomTopicInput :create-project="coordinatedCreate" @close="onChildClose" />
        </div>

        <!-- 任务11C：创建资格不合格时原地选择合格口播组合（三入口共用） -->
        <div v-if="pendingSelection" class="modal-tab-content">
          <NarrationCreationSelection
            :pending="pendingSelection"
            @confirm="confirmSelection"
            @cancel="cancelSelection"
          />
        </div>

        <div v-if="error" class="modal-error">
          <span>{{ error }}</span>
          <button
            class="modal-btn modal-btn--retry"
            :disabled="isGenerating"
            :aria-disabled="isGenerating"
            @click="handleGenerate"
          >重试</button>
        </div>
        <div class="modal-actions">
          <button
            v-if="activeTab === 'system'"
            class="modal-btn modal-btn--primary"
            data-testid="generate-topic"
            :disabled="isGenerating"
            :aria-disabled="isGenerating"
            :class="{ 'modal-btn--loading': isGenerating }"
            @click="handleGenerate"
          >
            <span v-if="isGenerating" class="btn-spinner"></span>
            <Lightning v-else />
            {{ isGenerating ? '创建中…' : '开始生成选题' }}
          </button>
        </div>
      </section>

    </div>
  </Teleport>
</template>

<style scoped>
* { box-sizing: border-box; }

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 6, 12, 0.72);
  backdrop-filter: blur(6px);
}

.modal-box {
  position: relative;
  width: 960px;
  max-width: 94vw;
  max-height: 90vh;
  min-height: 600px;
  overflow-y: auto;
  padding: 18px 54px 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--text-body);
  background: linear-gradient(180deg, #141c2b 0%, var(--bg-card) 160px);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 16px;
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.55);
}

.modal-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(212, 163, 95, 0.35), transparent);
}

button, input { font: inherit; }
button { letter-spacing: 0; }

.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  padding: 8px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 50%;
  cursor: pointer;
}

.modal-title {
  margin: 0 0 0 -30px;
  padding-right: 40px;
  color: var(--text-heading);
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.modal-tabs {
  align-self: center;
  display: inline-flex;
  gap: 2px;
  margin-top: -10px;
  padding: 5px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(212, 163, 95, 0.1);
  border-radius: 12px;
}

.tab-btn {
  min-width: 108px;
  padding: 10px 28px;
  color: var(--text-muted);
  font-size: 13.5px;
  background: none;
  border: 0;
  border-radius: 9px;
  cursor: pointer;
}
.tab-btn--active {
  color: var(--accent-primary);
  font-weight: 600;
  background: rgba(212, 163, 95, 0.14);
}

.modal-filters {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 16px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(212, 163, 95, 0.08);
  border-radius: 14px;
}

.basic-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr);
  gap: 18px;
}
.filter-group { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.filter-group--timeline { gap: 12px; }
.filter-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}
.chip-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.lens-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.chip {
  min-height: 36px;
  padding: 8px 15px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 100px;
  cursor: pointer;
}
.chip:hover { color: var(--text-body); border-color: rgba(212, 163, 95, 0.2); }
.chip--active {
  color: var(--accent-primary);
  font-weight: 600;
  background: rgba(212, 163, 95, 0.12);
  border-color: rgba(212, 163, 95, 0.35);
}
.lens-row .chip { width: 100%; min-width: 0; }

.child-filter {
  margin-top: 2px;
  padding: 12px 12px 10px;
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(212, 163, 95, 0.08);
  border-radius: 12px;
}
.filter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.filter-head--compact { align-items: center; }
.child-label { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
.child-label span { margin-left: 6px; color: var(--text-muted); font-size: 11px; font-weight: 500; }
.period-selection { max-width: 70%; color: rgba(212, 163, 95, 0.8); font-size: 11px; text-align: right; }
.period-range-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  margin-top: 4px;
  padding: 2px 0 5px;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(212, 163, 95, 0.26) transparent;
}
.period-range { position: relative; min-width: 476px; padding: 4px 6px 0; }
.period-track-shell { position: relative; height: 24px; margin-inline: calc(50% / var(--period-count)); }
.period-track, .period-track-active { position: absolute; top: 10px; height: 4px; border-radius: 4px; }
.period-track { left: 0; right: 0; background: rgba(255, 255, 255, 0.1); }
.period-track-active {
  top: 9px;
  left: var(--range-left);
  width: var(--range-width);
  height: 6px;
  background: #d9a85f;
  box-shadow: 0 0 12px rgba(217, 168, 95, 0.28);
}
.period-slider {
  position: absolute;
  top: 0;
  left: -9px;
  z-index: 3;
  width: calc(100% + 18px);
  height: 24px;
  margin: 0;
  appearance: none;
  background: transparent;
  pointer-events: none;
}
.period-slider--front { z-index: 4; }
.period-slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }
.period-slider:disabled::-moz-range-thumb { cursor: not-allowed; }
.period-slider::-webkit-slider-runnable-track { height: 4px; background: transparent; }
.period-slider::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  margin-top: -7px;
  appearance: none;
  background: var(--accent-primary-light);
  border: 2px solid #2b241d;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(212, 163, 95, 0.2);
  cursor: grab;
  pointer-events: auto;
}
.period-slider::-moz-range-track { height: 4px; background: transparent; }
.period-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--accent-primary-light);
  border: 2px solid #2b241d;
  border-radius: 50%;
  cursor: grab;
  pointer-events: auto;
}
.period-marks {
  display: grid;
  grid-template-columns: repeat(var(--period-count), minmax(0, 1fr));
  margin-top: -24px;
  pointer-events: none;
}
.period-mark {
  position: relative;
  min-width: 0;
  padding-top: 30px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
  white-space: nowrap;
}
.period-mark::before {
  content: '';
  position: absolute;
  top: 8px;
  left: 50%;
  width: 8px;
  height: 8px;
  background: #4c443b;
  border: 2px solid #211c18;
  border-radius: 50%;
  transform: translateX(-50%);
}
.period-mark--active { color: var(--accent-primary-light); font-weight: 600; }
.period-mark--active::before { background: var(--accent-primary-light); }

.advanced-toggle { padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.055); }
.advanced-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.advanced-title { color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.advanced-title::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 10px;
  vertical-align: middle;
  background: rgba(212, 163, 95, 0.76);
  border-radius: 50%;
}
.advanced-action {
  padding: 2px 0;
  color: rgba(212, 163, 95, 0.82);
  font-size: 12px;
  font-weight: 600;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.advanced-action:disabled { opacity: 0.55; cursor: not-allowed; }
.advanced-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.filter-mini {
  min-width: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.055);
  border-radius: 8px;
}
.filter-mini > .filter-label { margin-bottom: 9px; }
.option-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.option-grid .chip { width: 100%; min-width: 0; min-height: 30px; padding: 6px 5px; font-size: 12px; }
.filter-count { color: rgba(212, 163, 95, 0.74); font-size: 11px; }
.tag-input {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 25px;
  padding: 4px 9px;
  color: var(--accent-primary-light);
  font-size: 12px;
  white-space: nowrap;
  background: rgba(212, 163, 95, 0.09);
  border: 1px solid rgba(212, 163, 95, 0.16);
  border-radius: 100px;
}
.tag--bounded { max-width: 100%; min-width: 0; }
.tag-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag button {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  padding: 2px;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.tag button:disabled { opacity: 0.55; cursor: not-allowed; }
.tag-input input { min-width: 72px; flex: 1; color: var(--text-body); background: transparent; border: 0; outline: 0; font-size: 12px; }

.modal-tab-content { flex: 1; min-height: 320px; overflow-y: auto; }
.modal-error { padding: 12px; color: var(--text-secondary); background: rgba(239, 83, 80, 0.06); border: 1px solid rgba(239, 83, 80, 0.15); border-radius: 8px; }
.modal-actions { display: flex; justify-content: center; margin-top: auto; padding-top: 8px; }
.modal-btn { min-height: 48px; padding: 14px 32px; border: 0; border-radius: 100px; cursor: pointer; }
.modal-btn--primary {
  min-width: 184px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-inverse);
  font-weight: 600;
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  box-shadow: 0 4px 16px rgba(212, 163, 95, 0.25);
}
.modal-btn--primary svg { width: 18px; height: 18px; }
.modal-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.modal-btn--retry { min-height: 30px; margin-left: 12px; padding: 5px 16px; }
.btn-spinner { width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, 0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .modal-overlay { align-items: flex-start; padding: 12px; }
  .modal-box { min-height: calc(100vh - 24px); padding: 18px 20px 24px; }
  .modal-title { margin-left: 0; font-size: 24px; }
  .modal-tabs { align-self: stretch; }
  .tab-btn { min-width: 0; flex: 1; padding-inline: 10px; }
  .basic-grid, .advanced-panel { grid-template-columns: 1fr; }
  .modal-filters { padding: 18px 16px; }
  .modal-btn--primary { width: 100%; }
}

@media (max-width: 420px) {
  .option-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .period-selection { max-width: 62%; }
}
</style>
