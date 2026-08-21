<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import GenerationStrategySettings from "./GenerationStrategySettings.vue";
import CreativeVoiceSettings from "./CreativeVoiceSettings.vue";
import CreativeArtStyleSettings from "./CreativeArtStyleSettings.vue";
import CreativeSubtitleSettings from "./CreativeSubtitleSettings.vue";
import {
  computeConfigInvalidationPreview,
  useGenerationConfigStore,
  type ApiVideoQualityValue,
  type CreativePreferenceInput,
  type VideoGenerationStrategyValue,
} from "../../stores/generation-config";
import {
  createFetchCreativePresetsApi,
  useCreativePresetsStore,
  type VoicePreviewResult,
} from "../../stores/creative-presets";
import { createFetchGenerationCostApi } from "../../stores/generation-cost";
import { ApiError } from "../../utils/api";

/**
 * S2-2A 任务 10：项目生成设置（工作区内对话框）。
 * 展示项目当前值、来源（继承自创建时用户默认）、与当前用户默认差异、
 * 保存前失效预览；保存走项目配置 PATCH（乐观并发）。
 */

const props = defineProps<{
  projectId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useGenerationConfigStore();

const draft = reactive({
  strategy: "prefer_remotion" as VideoGenerationStrategyValue,
  apiQuality: "standard_720p" as ApiVideoQualityValue,
  budgetMicros: null as string | null,
  // S2-2B 创作偏好
  voiceProfileId: null as string | null,
  artStylePresetId: null as string | null,
  subtitlePresetId: null as string | null,
  subtitleOverrides: {} as Record<string, unknown>,
});

const creativeStore = useCreativePresetsStore();

function draftCreative(): CreativePreferenceInput {
  return {
    voice_profile_id: draft.voiceProfileId,
    art_style_preset_id: draft.artStylePresetId,
    subtitle_style_preset_id: draft.subtitlePresetId,
    subtitle_style_overrides: draft.subtitleOverrides,
  };
}
const budgetInvalid = ref(false);
const saveError = ref<string | null>(null);
const loaded = ref(false);

const configState = computed(() => store.state.projectConfigs[props.projectId]);
const config = computed(() => configState.value?.data ?? null);

function applyServerData() {
  const data = store.state.projectConfigs[props.projectId]?.data;
  if (!data) return;
  draft.strategy = data.configuration.video.strategy;
  draft.apiQuality = data.configuration.video.api_quality;
  draft.budgetMicros = data.configuration.budget.max_paid_cost_micros_per_run;
  draft.voiceProfileId = data.configuration.creative.voice_profile_id;
  draft.artStylePresetId = data.configuration.creative.art_style_preset_id;
  draft.subtitlePresetId = data.configuration.creative.subtitle_style_preset_id;
  draft.subtitleOverrides = { ...(data.configuration.creative.subtitle_style_overrides ?? {}) };
}

watch(
  () => [props.open, props.projectId] as const,
  async ([open, projectId]) => {
    if (!open || !projectId) return;
    loaded.value = false;
    // 重开对话框时清空上次会话残留状态
    saveError.value = null;
    budgetInvalid.value = false;
    await store.loadProjectConfig(projectId);
    await Promise.all([creativeStore.loadCreativePresets(), creativeStore.loadVoiceProfiles()]);
    applyServerData();
    loaded.value = true;
  },
  { immediate: true },
);

// 409 冲突重载后表单同步服务器最新值，避免基于旧视图的第二次保存覆盖竞争修改。
// B2 整改：盯 conflictEpoch（每次冲突自增）而非布尔 conflict——连续两次 409
// 时 true→true 不触发 watcher，旧实现会漏掉第二次冲突的同步。
watch(
  () => configState.value?.conflictEpoch,
  () => {
    if (configState.value?.conflict) applyServerData();
  },
);

const sourceNote = computed(() => {
  if (!config.value) return "";
  if (config.value.source_user_preference_revision !== null) {
    return `继承自创建时用户默认（来源偏好版本 ${config.value.source_user_preference_revision}）`;
  }
  return "项目尚未设置，当前为系统默认回填";
});

const hasDiff = computed(() => {
  const diff = config.value?.diff_from_user_default;
  return diff !== null && diff !== undefined && Object.keys(diff).length > 0;
});

const invalidationPreview = computed(() => {
  if (!config.value || !loaded.value) return null;
  return computeConfigInvalidationPreview(
    {
      video: config.value.configuration.video,
      creative: config.value.configuration.creative,
    },
    {
      video: { strategy: draft.strategy, api_quality: draft.apiQuality },
      creative: draftCreative(),
    },
  );
});

const previewStageLabels: Record<string, string> = {
  storyboard_route_resolution: "分镜路线解析",
  asset_planning: "资产规划",
  assets: "资产生成",
  quote: "报价",
  none: "无",
};

function previewStageText(stages: string[]): string {
  return stages.map((stage) => previewStageLabels[stage] ?? stage).join("、");
}

async function save() {
  saveError.value = null;
  if (budgetInvalid.value) {
    saveError.value = "预算金额格式不正确：请输入非负金额，最多 6 位小数。";
    return;
  }
  const result = await store.saveProjectConfig(props.projectId, {
    video: { strategy: draft.strategy, api_quality: draft.apiQuality },
    budgetMicros: draft.budgetMicros,
    creative: draftCreative(),
  });
  if (!result.ok) {
    if (!result.conflict) {
      saveError.value = "保存失败，请稍后重试。";
    }
    // 409 冲突：保留对话框，让用户看到"配置已被其他会话更新"告警与重载后的值
    return;
  }
  // 保存成功：表单已同步服务器值，关闭对话框
  emit("close");
}

// --- S2-2B 试听（项目级） ----------------------------------------------------
// 外部审查两轮整改后的合同：
// - stub/fake 部署（无可报价 provider）先直接请求免 quote 试听——成功即播放，
//   不创建报价；只有服务端返回 409 paid_generation_quote_required（付费部署）
//   才进入报价流程。
// - 报价流程：创建 quote → 弹窗展示金额/授权上界 → 用户确认后提交**同一张**
//   quote（quote_id 原样提交，绝不二次创建；run_overrides 重放）。
// - 幂等键在报价创建时生成并随报价保存；提交失败（网络不确定）保留弹窗，
//   重试复用同一 quote_id + idempotency_key——服务端已消费时重放返回原结果，
//   不重复执行/计费。成功或用户取消才清空。
const previewQuote = ref<{
  quoteId: string;
  voiceProfileId: string;
  idempotencyKey: string;
  estimatedCostCny: string;
  authorizationCostCny: string;
  requiresBudgetOverride: boolean;
} | null>(null);
const previewPending = ref(false);
const previewError = ref<string | null>(null);

function previewRunOverrides(voiceProfileId: string): Record<string, unknown> {
  return { creative: { voice_profile_id: voiceProfileId } };
}

function isPaidQuoteRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (String(error.code).includes("paid_generation_quote_required") ||
      String(error.code).includes("请先创建报价"))
  );
}

function newPreviewIdempotencyKey(voiceProfileId: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Date.now());
  return `voice-preview-${random}-${voiceProfileId}`;
}

async function handleVoicePreview(voiceProfileId: string): Promise<VoicePreviewResult | null> {
  previewError.value = null;
  previewPending.value = true;
  const previewApi = createFetchCreativePresetsApi();
  try {
    // 先走免 quote 试听：stub/fake 部署直接返回合成音频（零费用）
    const direct = await previewApi.requestVoicePreview(props.projectId, voiceProfileId);
    if (direct?.preview_audio_uri) {
      playPreviewAudio(direct.preview_audio_uri);
      return direct;
    }
    return null;
  } catch (error) {
    if (!isPaidQuoteRequiredError(error)) {
      previewError.value = error instanceof Error ? error.message : "试听失败，请稍后重试。";
      return null;
    }
    // 付费部署（409 paid_generation_quote_required）→ 报价确认流程
    try {
      const quoteApi = createFetchGenerationCostApi();
      const quote = await quoteApi.createQuote(props.projectId, {
        operation: "voice.preview",
        runOverrides: previewRunOverrides(voiceProfileId),
      });
      previewQuote.value = {
        quoteId: quote.quote_id,
        voiceProfileId,
        idempotencyKey: newPreviewIdempotencyKey(voiceProfileId),
        estimatedCostCny: quote.estimated_cost_cny,
        authorizationCostCny: quote.authorization_cost_cny,
        requiresBudgetOverride: quote.requires_budget_override,
      };
      return null;
    } catch (quoteError) {
      previewError.value = quoteError instanceof Error ? quoteError.message : "报价失败，请稍后重试。";
      return null;
    }
  } finally {
    previewPending.value = false;
  }
}

function playPreviewAudio(uri: string): void {
  const audio = new Audio(uri);
  void audio.play().catch(() => {
    previewError.value = "音频播放失败。";
  });
}

async function confirmPreview() {
  if (!previewQuote.value) return;
  const { quoteId, voiceProfileId, idempotencyKey, requiresBudgetOverride } = previewQuote.value;
  previewPending.value = true;
  previewError.value = null;
  try {
    const previewApi = createFetchCreativePresetsApi();
    const result = await previewApi.requestVoicePreview(props.projectId, voiceProfileId, {
      // 提交弹窗展示的同一张 quote（用户已确认其金额与授权上界）；
      // 幂等键为报价创建时生成的稳定值——失败重试复用，服务端按
      // (project, operation, idempotency_key) 判重返回原结果。
      cost_quote_id: quoteId,
      idempotency_key: idempotencyKey,
      authorize_budget_override: requiresBudgetOverride,
      run_overrides: previewRunOverrides(voiceProfileId),
    });
    if (result?.preview_audio_uri) {
      playPreviewAudio(result.preview_audio_uri);
    }
    previewQuote.value = null;
  } catch (error) {
    // 网络不确定失败：保留报价确认状态（同一 quote + 幂等键可安全重试；
    // 服务端若已消费，重放会返回原结果）。用户可点取消放弃。
    previewError.value =
      error instanceof Error ? error.message : "试听失败，请重试（将复用同一报价与幂等键）。";
  } finally {
    previewPending.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="项目生成设置"
    width="680px"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <div class="project-settings">
      <section v-if="configState?.loading || !loaded" class="project-settings-loading">正在加载项目配置…</section>
      <template v-else-if="config">
        <el-alert
          v-if="configState?.conflict"
          type="warning"
          :closable="false"
          title="项目配置已被其他会话更新"
          description="已重新加载服务器最新配置，请基于最新值重新调整后再保存。"
          show-icon
        />

        <section class="project-meta">
          <div class="project-meta-row">
            <span class="project-meta-label">配置来源</span>
            <span>{{ sourceNote }}</span>
          </div>
          <div class="project-meta-row">
            <span class="project-meta-label">与当前用户默认差异</span>
            <span>{{ hasDiff ? "与当前用户默认不同（以项目配置为准）" : "与当前用户默认一致" }}</span>
          </div>
        </section>

        <GenerationStrategySettings
          v-model:strategy="draft.strategy"
          v-model:api-quality="draft.apiQuality"
          v-model:budget-micros="draft.budgetMicros"
          v-model:budget-invalid="budgetInvalid"
          :disabled="configState?.saving"
          test-id-prefix="project-"
        />

        <section class="creative-section" data-testid="project-creative-settings">
          <CreativeVoiceSettings
            v-model="draft.voiceProfileId"
            :profiles="creativeStore.state.voiceProfiles"
            :disabled="configState?.saving"
            :project-id="props.projectId"
            :on-preview="handleVoicePreview"
          />
          <CreativeArtStyleSettings
            v-model="draft.artStylePresetId"
            :presets="creativeStore.state.artStylePresets"
            :disabled="configState?.saving"
          />
          <CreativeSubtitleSettings
            v-model="draft.subtitlePresetId"
            :overrides="draft.subtitleOverrides"
            :presets="creativeStore.state.subtitlePresets"
            :disabled="configState?.saving"
            @update:overrides="(value: Record<string, unknown>) => (draft.subtitleOverrides = value)"
          />
        </section>

        <section
          v-if="invalidationPreview"
          class="project-invalidation"
          data-testid="project-invalidation-preview"
        >
          <h4 class="project-invalidation-title">保存后影响预览</h4>
          <p class="project-invalidation-stages">
            受影响阶段：<strong>{{ previewStageText(invalidationPreview.affected_stages) }}</strong>
          </p>
          <p class="project-invalidation-note">{{ invalidationPreview.note }}</p>
        </section>

        <p v-if="saveError" class="project-settings-error">{{ saveError }}</p>
      </template>
      <p v-else class="project-settings-error">项目配置加载失败，请关闭后重试。</p>
    </div>
    <el-dialog
      v-if="previewQuote"
      :model-value="true"
      title="试听报价确认"
      width="460px"
      append-to-body
    >
      <p class="preview-quote-text">
        该音色尚未生成试听音频，试听将产生费用：预计 {{ previewQuote.estimatedCostCny }} 元，
        授权上界 {{ previewQuote.authorizationCostCny }} 元。
        <template v-if="previewQuote.requiresBudgetOverride">其中包含无法预估价格的项目，需要显式确认。</template>
      </p>
      <template #footer>
        <button class="btn btn-ghost" @click="previewQuote = null">取消</button>
        <button
          class="btn btn-primary"
          :disabled="previewPending"
          data-testid="confirm-voice-preview"
          @click="confirmPreview"
        >
          {{ previewPending ? "试听中…" : "确认并试听" }}
        </button>
      </template>
    </el-dialog>
    <p v-if="previewError" class="project-settings-error" data-testid="voice-preview-error">{{ previewError }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button
        class="btn btn-primary"
        data-testid="save-project-config"
        :disabled="configState?.saving || budgetInvalid || !loaded"
        @click="save"
      >
        {{ configState?.saving ? "保存中…" : "保存项目设置" }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.project-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.project-settings-loading {
  color: #a89f94;
  font-size: 13px;
}

.project-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.project-meta-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #d8d0c7;
}

.project-meta-label {
  min-width: 132px;
  color: #a89f94;
}

.project-invalidation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid rgba(224, 122, 95, 0.3);
  border-radius: 10px;
  background: rgba(224, 122, 95, 0.06);
}

.project-invalidation-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #e0a883;
}

.project-invalidation-stages,
.project-invalidation-note {
  margin: 0;
  font-size: 12px;
  color: #d8d0c7;
}

.project-settings-error {
  color: #e07a5f;
  font-size: 13px;
  margin: 0;
}

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.018);
  border: 1px solid rgba(201, 162, 39, 0.13);
  color: #a89f94;
  margin-right: 10px;
}

.btn-primary {
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.4);
  color: #f5f0e8;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.creative-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}

.preview-quote-text {
  margin: 0;
  font-size: 13px;
  color: #d8d0c7;
  line-height: 1.6;
}
</style>
