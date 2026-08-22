<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElIcon,
  ElImage,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from "element-plus";
import {
  Check,
  Edit,
  Plus,
  Refresh,
  Upload,
  MagicStick,
  Picture,
} from "@element-plus/icons-vue";

import { usePublishStore, type TitleCandidate } from "../../stores/publish";
import { useProjectStore } from "../../stores/project";
import { useWorkspaceStore, PIPELINE_STEPS } from "../../stores/workspace";
import { useGenerationCostStore } from "../../stores/generation-cost";
import { createQuoteAwareGeneration } from "../../composables/useQuoteAwareGeneration";
import GenerationQuoteDialog from "../asset/GenerationQuoteDialog.vue";
import { useRouter, useRoute } from "vue-router";
import StageGenerating from "../workspace/StageGenerating.vue";

const publishStore = usePublishStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const costStore = useGenerationCostStore();
const router = useRouter();
const route = useRoute();

// S2-2D：免 quote 优先 → 409 进报价（stub/fake 部署零行为变化）。发布包与
// 封面生成共用同一编排，动作经闭包变量区分。
let currentPublishAction: "package" | "cover" = "package";
const quoteAware = createQuoteAwareGeneration({
  operation: "publish.generate",
  createQuoteRequest: () => ({ operation: "publish.generate" }),
  tryDirect: () =>
    currentPublishAction === "cover"
      ? publishStore.generateCover()
      : publishStore.generatePackage(),
  submitWithQuote: (submit) =>
    currentPublishAction === "cover"
      ? publishStore.generateCover(submit)
      : publishStore.generatePackage(submit),
  costStore,
  projectId: () => projectStore.state.projectId ?? "",
  onQuoteUnavailable: (message) => {
    ElMessage.warning(message);
  },
});

const COMPOSE_RENDER_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "compose-render");

/* -------------------------------------------------------------------------- */
/*  Computed                                                                  */
/* -------------------------------------------------------------------------- */

const snapshot = computed(() => publishStore.state.snapshot);
const pkg = computed(() => snapshot.value?.active_publish_package ?? null);
const hasPkg = computed(() => !!pkg.value);
const isStale = computed(() => pkg.value?.is_stale ?? false);
const staleReason = computed(() => pkg.value?.stale_reason ?? null);
const coverArtifact = computed(() => pkg.value?.cover_artifact ?? null);
const coverOrigin = computed(() => pkg.value?.package.cover_origin ?? "storyboard_image");

const coverOriginLabel = computed(() => {
  const map: Record<string, string> = {
    storyboard_image: "默认（分镜图）",
    manual_upload: "手动上传",
    generated: "AI 生成",
  };
  return map[coverOrigin.value] ?? coverOrigin.value;
});

const coverPreviewUrl = computed(() => {
  const pid = projectStore.state.projectId;
  const art = coverArtifact.value;
  if (!pid || !art?.artifact_id) return null;
  return `/api/projects/${pid}/artifacts/${art.artifact_id}/file`;
});

// Video preview data from active_render
const activeRender = computed(() => snapshot.value?.active_render ?? null);
const videoArtifact = computed(() => activeRender.value?.output_artifact ?? null);

const videoPreviewUrl = computed(() => {
  const pid = projectStore.state.projectId;
  if (!pid || !videoArtifact.value) return null;
  return `/api/projects/${pid}/render/preview`;
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const videoInfo = computed(() => {
  const art = videoArtifact.value;
  if (!art) return null;
  const rawSize = (art.metadata?.file_size_bytes as number | undefined);
  return {
    duration: art.duration_sec ? `${art.duration_sec.toFixed(1)}s` : "—",
    resolution: art.width && art.height ? `${art.width}x${art.height}` : "—",
    fps: art.fps ? `${art.fps} fps` : "—",
    fileSize: typeof rawSize === "number" ? formatFileSize(rawSize) : "—",
  };
});

const coverPrompt = computed(() => pkg.value?.package.cover_prompt_draft ?? "");

function onCoverPromptChange(val: string) {
  publishStore.updatePackage({ cover_prompt_draft: val });
}

const titleCandidates = computed(() => pkg.value?.package.title_candidates ?? []);
const selectedTitle = computed(() => pkg.value?.package.selected_title ?? "");

function onSelectedTitleChange(val: string) {
  publishStore.updatePackage({ selected_title: val });
}

const description = computed(() => pkg.value?.package.description ?? "");

function onDescriptionChange(val: string) {
  publishStore.updatePackage({ description: val });
}

const hashtags = computed(() => pkg.value?.package.hashtags ?? []);

const readiness = computed(() => pkg.value?.package.readiness ?? "draft");

const readinessLabel = computed(() => {
  const map: Record<string, string> = {
    generating: "生成中",
    draft: "草稿",
    ready: "就绪",
    blocked: "阻塞",
  };
  return map[readiness.value] ?? readiness.value;
});

const readinessType = computed(() => {
  if (readiness.value === "ready") return "success";
  if (readiness.value === "blocked") return "danger";
  if (readiness.value === "generating") return "warning";
  return "info";
});

/* -------------------------------------------------------------------------- */
/*  Dialog state                                                              */
/* -------------------------------------------------------------------------- */

const showCoverGenerateConfirm = ref(false);
const showCoverUploadDialog = ref(false);
const showExportResultDialog = ref(false);
const coverUploadUri = ref("");
const coverUploadMime = ref("image/png");

// Missing fields for informational purposes
const missingFields = computed(() => {
  const m: string[] = [];
  if (!selectedTitle.value) m.push("标题");
  if (!description.value) m.push("描述");
  if (!hashtags.value.length) m.push("话题标签");
  if (!coverArtifact.value && !coverPrompt.value) m.push("封面图或封面提示词");
  return m;
});

/* -------------------------------------------------------------------------- */
/*  Title candidates                                                          */
/* -------------------------------------------------------------------------- */

const externalCandidates = ref<TitleCandidate[]>([]);
const isLoadingCandidates = ref(false);

const allCandidates = computed(() => {
  const saved = titleCandidates.value;
  if (saved.length > 0) return saved;
  return externalCandidates.value;
});

const styleLabel = (style: string) => {
  const map: Record<string, string> = {
    standard: "标准",
    suspense: "悬念",
    knowledge: "知识",
    emotional: "情绪",
  };
  return map[style] ?? style;
};

const styleType = (style: string) => {
  const map: Record<string, string> = {
    standard: "info",
    suspense: "warning",
    knowledge: "primary",
    emotional: "danger",
  };
  return map[style] ?? "";
};

/* -------------------------------------------------------------------------- */
/*  Hashtags                                                                  */
/* -------------------------------------------------------------------------- */

const newHashtag = ref("");

function addHashtag() {
  const tag = newHashtag.value.trim();
  if (!tag || hashtags.value.includes(tag)) return;
  publishStore.updatePackage({ hashtags: [...hashtags.value, tag] });
  newHashtag.value = "";
}

function removeHashtag(tag: string) {
  publishStore.updatePackage({ hashtags: hashtags.value.filter((t) => t !== tag) });
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                   */
/* -------------------------------------------------------------------------- */

async function handleGenerate() {
  currentPublishAction = "package";
  const result = await quoteAware.run();
  if (publishStore.state.loadError) {
    ElMessage.warning("发布包生成失败：" + publishStore.state.loadError);
    return;
  }
  if (result.ok) {
    ElMessage.success("发布包已生成");
  }
  // pending_confirmation：报价弹窗等待确认；quote_unavailable：已提示
}

async function handleOptimizeCover() {
  try {
    const result = await publishStore.optimizeCoverPrompt();
    await publishStore.updatePackage({ cover_prompt_draft: result.optimized_prompt });
    ElMessage.success("封面提示词已优化");
  } catch {
    ElMessage.error("封面提示词优化失败");
  }
}

async function handleUploadCover() {
  if (!coverUploadUri.value) return;
  await publishStore.uploadCover(coverUploadUri.value, coverUploadMime.value);
  showCoverUploadDialog.value = false;
  coverUploadUri.value = "";
  if (!publishStore.state.loadError) {
    ElMessage.success("封面图已上传");
  }
}

function confirmGenerateCover() {
  showCoverGenerateConfirm.value = true;
}

async function handleGenerateCover() {
  showCoverGenerateConfirm.value = false;
  currentPublishAction = "cover";
  const result = await quoteAware.run();
  if (publishStore.state.loadError) {
    ElMessage.warning("封面图生成失败：" + publishStore.state.loadError);
    return;
  }
  if (result.ok) {
    ElMessage.success("封面图生成任务已提交，请稍后刷新查看");
  }
  // pending_confirmation：报价弹窗等待确认；quote_unavailable：已提示
}

/** S2-2D：报价弹窗确认 → 携带 quote 提交；过期自动重新报价；冲突提示重新报价。 */
async function handleQuoteConfirm(payload: { authorizeBudgetOverride: boolean }) {
  const result = await quoteAware.confirm(payload.authorizeBudgetOverride);
  if (result.ok) {
    if (!publishStore.state.loadError) {
      ElMessage.success(
        currentPublishAction === "cover"
          ? "封面图生成任务已提交，请稍后刷新查看"
          : "发布包已生成",
      );
    }
    return;
  }
  if (result.reason === "expired") {
    ElMessage.warning("报价已过期，正在重新报价");
    await quoteAware.run();
    return;
  }
  if (result.reason === "conflict") {
    ElMessage.warning("生成被拒绝（" + result.message + "），请重新报价后再试");
  }
  // error（网络不确定）：弹窗保留，用户可直接重试确认（同一 quote + 幂等键）
}

async function handleLoadTitleCandidates() {
  isLoadingCandidates.value = true;
  try {
    const result = await publishStore.loadTitleCandidates();
    externalCandidates.value = result.candidates;
  } catch {
    ElMessage.error("标题候选加载失败");
  } finally {
    isLoadingCandidates.value = false;
  }
}

function selectTitle(candidate: TitleCandidate) {
  publishStore.updatePackage({ selected_title: candidate.text });
}

async function handleExport() {
  // Warn about missing cover
  if (!coverArtifact.value) {
    try {
      await ElMessageBox.confirm(
        "封面图缺失，导出包中将仅包含封面提示词。是否继续？",
        "封面缺失",
        { confirmButtonText: "继续导出", cancelButtonText: "取消", type: "warning" }
      );
    } catch {
      return;
    }
  }

  try {
    const manifest = await publishStore.exportPackage();
    showExportResultDialog.value = true;
  } catch {
    ElMessage.error("导出失败");
  }
}

function goToComposeRender() {
  workspaceStore.setCurrentStep(COMPOSE_RENDER_STEP_INDEX);
  const pid = projectStore.state.projectId;
  if (pid) router.push(`/projects/${pid}/compose-render`);
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(async () => {
  await publishStore.loadProject();
  if (route.query.auto === "true" && !hasPkg.value) {
    await publishStore.generatePackage();
  }
});
</script>

<template>
  <div class="publish-panel">
    <!-- Error -->
    <div v-if="publishStore.state.loadError" class="publish-error-card">
      <el-alert
        :title="'加载失败：' + publishStore.state.loadError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-button
        type="primary"
        :loading="publishStore.state.isLoading"
        @click="publishStore.loadProject()"
      >
        重试
      </el-button>
    </div>

    <!-- Generating package -->
    <StageGenerating
      v-else-if="publishStore.state.isGenerating && !hasPkg"
      title="正在生成发布包"
      hint="正在生成标题、简介、标签和发布元数据，生成完成后会自动显示编辑内容。"
      secondary-hint="请稍候，无需重复点击生成。"
    />

    <!-- Loading -->
    <el-skeleton
      v-else-if="publishStore.state.isLoading && !hasPkg"
      :rows="5"
      animated
      class="publish-skeleton"
    />

    <!-- No package -->
    <div v-else-if="!hasPkg" class="publish-empty">
      <div class="publish-empty-card">
        <div class="publish-empty-icon">📦</div>
        <h2 class="publish-empty-title">发布包尚未生成</h2>
        <p class="publish-empty-hint">生成发布包后，将自动为您准备标题候选、描述、话题标签及封面图。</p>
        <div class="publish-empty-line"></div>
        <el-button
          type="primary"
          :loading="publishStore.state.isGenerating"
          @click="handleGenerate"
        >
          生成发布包
        </el-button>
      </div>
    </div>

    <!-- Main content -->
    <template v-else>
      <!-- Page title -->
      <h1 class="publish-page-title">发布<em>交互编辑</em></h1>

      <!-- Stale warning -->
      <div v-if="isStale" class="publish-stale-card">
        <el-alert
          title="渲染输出已变更，发布包可能过期"
          type="warning"
          show-icon
          :closable="false"
        >
          <template #default>
            <p>视频已重新渲染，当前发布包的封面和元数据可能不再匹配。</p>
            <el-button
              type="primary"
              size="small"
              :loading="publishStore.state.isGenerating"
              @click="handleGenerate"
            >
              重新生成
            </el-button>
          </template>
        </el-alert>
      </div>

      <!-- Status bar -->
      <div class="publish-status-bar">
        <el-tag :type="readinessType">
          {{ readinessLabel }}
        </el-tag>
        <span v-if="isStale" class="publish-stale-badge">过期</span>
        <span class="publish-cover-origin">封面来源：{{ coverOriginLabel }}</span>
      </div>

      <div class="publish-grid">
        <!-- Left: Video + Cover -->
        <div class="publish-left">
          <!-- Video preview -->
          <div v-if="videoArtifact" class="publish-card">
            <div class="publish-card-header">成品视频</div>
            <div class="publish-card-body">
              <div class="publish-video-preview">
                <video
                  v-if="videoPreviewUrl"
                  :src="videoPreviewUrl"
                  controls
                  preload="metadata"
                  class="publish-video-player"
                >
                  您的浏览器不支持视频播放
                </video>
                <div v-else class="publish-video-placeholder">
                  <span>视频预览不可用</span>
                </div>
              </div>
              <div v-if="videoInfo" class="publish-video-meta">
                <span class="publish-meta-item">时长：{{ videoInfo.duration }}</span>
                <span class="publish-meta-item">分辨率：{{ videoInfo.resolution }}</span>
                <span class="publish-meta-item">帧率：{{ videoInfo.fps }}</span>
                <span class="publish-meta-item">大小：{{ videoInfo.fileSize }}</span>
              </div>
            </div>
          </div>

          <!-- Cover section -->
          <div class="publish-card">
            <div class="publish-card-header">封面图</div>
            <div class="publish-card-body">
              <div class="publish-cover-preview">
                <el-image
                  v-if="coverPreviewUrl"
                  :src="coverPreviewUrl"
                  fit="contain"
                  class="publish-cover-image"
                >
                  <template #error>
                    <div class="publish-cover-placeholder">
                      <el-icon :size="48"><Picture /></el-icon>
                      <span>封面预览不可用</span>
                    </div>
                  </template>
                </el-image>
                <div v-else class="publish-cover-placeholder">
                  <el-icon :size="48"><Picture /></el-icon>
                  <span>暂无封面图</span>
                </div>
              </div>

              <div class="publish-cover-prompt-section">
                <label class="publish-field-label">封面提示词</label>
                <el-input
                  :model-value="coverPrompt"
                  type="textarea"
                  :rows="3"
                  placeholder="输入封面图提示词..."
                  @change="onCoverPromptChange"
                />
                <div class="publish-cover-prompt-actions">
                  <el-button
                    size="small"
                    :icon="MagicStick"
                    :loading="publishStore.state.isOptimizingCover"
                    @click="handleOptimizeCover"
                  >
                    LLM 优化
                  </el-button>
                  <div class="publish-cover-generate-action">
                    <el-button
                      size="small"
                      type="primary"
                      :icon="MagicStick"
                      :loading="publishStore.state.isGeneratingCover"
                      @click="confirmGenerateCover"
                    >
                      AI 生成封面
                    </el-button>
                    <span class="publish-cost-label">约 ¥0.20/次</span>
                  </div>
                  <el-button
                    size="small"
                    :icon="Upload"
                    @click="showCoverUploadDialog = true"
                  >
                    上传封面
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Title + Description + Hashtags -->
        <div class="publish-right">
          <!-- Title section -->
          <div class="publish-card">
            <div class="publish-card-header">标题</div>
            <div class="publish-card-body">
              <div class="publish-selected-title">
                <el-input
                  :model-value="selectedTitle"
                  placeholder="选择或输入标题..."
                  maxlength="30"
                  show-word-limit
                  @change="onSelectedTitleChange"
                />
              </div>

              <div class="publish-title-candidates-section">
                <div class="publish-section-header">
                  <span class="publish-field-label">标题候选</span>
                  <el-button
                    size="small"
                    :icon="Refresh"
                    :loading="isLoadingCandidates"
                    @click="handleLoadTitleCandidates"
                  >
                    生成候选
                  </el-button>
                </div>

                <div v-if="allCandidates.length > 0" class="publish-candidate-list">
                  <div
                    v-for="c in allCandidates"
                    :key="c.candidate_id"
                    class="publish-candidate-item"
                    :class="{ selected: selectedTitle === c.text }"
                    @click="selectTitle(c)"
                  >
                    <div class="publish-candidate-text">{{ c.text }}</div>
                    <div class="publish-candidate-meta">
                      <el-tag :type="styleType(c.style)" size="small">
                        {{ styleLabel(c.style) }}
                      </el-tag>
                      <el-icon v-if="selectedTitle === c.text" class="publish-selected-icon">
                        <Check />
                      </el-icon>
                    </div>
                  </div>
                </div>
                <div v-else class="publish-no-candidates">
                  <span>点击"生成候选"获取 LLM 标题建议</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Description section -->
          <div class="publish-card">
            <div class="publish-card-header">描述</div>
            <div class="publish-card-body">
              <el-input
                :model-value="description"
                type="textarea"
                :rows="5"
                maxlength="500"
                show-word-limit
                placeholder="输入视频描述..."
                @change="onDescriptionChange"
              />
            </div>
          </div>

          <!-- Hashtags section -->
          <div class="publish-card">
            <div class="publish-card-header">话题标签</div>
            <div class="publish-card-body">
              <div class="publish-hashtag-list">
                <el-tag
                  v-for="tag in hashtags"
                  :key="tag"
                  closable
                  class="publish-hashtag-chip"
                  @close="removeHashtag(tag)"
                >
                  #{{ tag }}
                </el-tag>
                <span v-if="hashtags.length === 0" class="publish-no-hashtags">
                  暂无标签
                </span>
              </div>
              <div class="publish-hashtag-input">
                <el-input
                  v-model="newHashtag"
                  size="small"
                  placeholder="添加标签..."
                  @keyup.enter="addHashtag"
                >
                  <template #append>
                    <el-button :icon="Plus" @click="addHashtag" />
                  </template>
                </el-input>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom actions -->
      <div class="publish-actions">
        <el-button
          :loading="publishStore.state.isGenerating"
          @click="handleGenerate"
        >
          重新生成发布信息
        </el-button>
        <el-button
          type="primary"
          :disabled="!hasPkg"
          @click="handleExport"
        >
          导出发布包
        </el-button>
      </div>
    </template>

    <!-- Cover Generate Confirmation Dialog -->
    <el-dialog
      v-model="showCoverGenerateConfirm"
      title="确认生成封面图"
      width="420px"
    >
      <p>AI 生成封面图将调用 DashScope 图片生成接口，</p>
      <p><strong>每次生成会产生费用（约 ¥0.20/次）</strong>，是否继续？</p>
      <p class="cost-hint">建议先使用"LLM 优化"调整提示词，确认满意后再生成。</p>
      <template #footer>
        <el-button @click="showCoverGenerateConfirm = false">取消</el-button>
        <el-button type="primary" @click="handleGenerateCover">
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <!-- Cover Upload Dialog -->
    <el-dialog
      v-model="showCoverUploadDialog"
      title="上传封面图"
      width="400px"
    >
      <div class="upload-form">
        <label class="publish-field-label">文件 URI</label>
        <el-input v-model="coverUploadUri" placeholder="file://storage/uploads/cover.png" />
        <label class="publish-field-label">MIME 类型</label>
        <el-input v-model="coverUploadMime" placeholder="image/png" />
        <p class="upload-hint">支持 image/png 和 image/jpeg 格式</p>
      </div>
      <template #footer>
        <el-button @click="showCoverUploadDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="publishStore.state.isUploadingCover"
          @click="handleUploadCover"
        >
          上传
        </el-button>
      </template>
    </el-dialog>

    <!-- Export Result Dialog -->
    <el-dialog
      v-model="showExportResultDialog"
      title="导出成功"
      width="480px"
    >
      <template v-if="publishStore.state.exportManifest">
        <p><strong>导出文件：</strong>{{ publishStore.state.exportManifest.project_title }}-发布包.zip</p>
        <p style="color: var(--text-secondary); font-size: 13px;">文件已通过浏览器下载，包含以下内容：</p>
        <el-table
          :data="(publishStore.state.exportManifest.files || []).map(f => ({ name: f }))"
          size="small"
          style="margin: 12px 0;"
        >
          <el-table-column prop="name" label="文件清单" />
        </el-table>
        <p style="margin-top: 12px;">
          <strong>标题：</strong>{{ publishStore.state.exportManifest.title || "（无）" }}
        </p>
        <p>
          <strong>描述：</strong>{{ publishStore.state.exportManifest.description || "（无）" }}
        </p>
        <p>
          <strong>话题标签：</strong>{{ publishStore.state.exportManifest.hashtags.join("、") || "（无）" }}
        </p>
        <p>
          <strong>封面：</strong>
          {{ publishStore.state.exportManifest.has_cover_image ? "已包含" : "仅提示词" }}
        </p>
        <p>
          <strong>导出时间：</strong>{{ publishStore.state.exportManifest.exported_at }}
        </p>
        <div
          v-if="publishStore.state.exportManifest.missing_fields.length > 0"
          style="margin-top: 8px; color: var(--color-warning); font-size: 13px;"
        >
          ⚠ 缺失项：{{ publishStore.state.exportManifest.missing_fields.join("、") }}
        </div>
      </template>
      <template #footer>
        <el-button type="primary" @click="showExportResultDialog = false">确定</el-button>
      </template>
    </el-dialog>

    <!-- S2-2D：真实付费部署的报价确认弹窗（stub/fake 部署不出现） -->
    <GenerationQuoteDialog
      :open="quoteAware.state.confirmVisible"
      :quote="quoteAware.state.quote"
      :loading="quoteAware.state.pending"
      @confirm="handleQuoteConfirm"
      @cancel="quoteAware.cancel()"
    />
  </div>
</template>

<style scoped>
.publish-panel {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
}

/* ---- Page title ---- */
.publish-page-title {
  margin: 0 0 2px;
  color: #f5f0e8;
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 28px;
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.publish-page-title em {
  color: #e4c26f;
  font-style: normal;
}

/* ---- Skeleton ---- */
.publish-skeleton {
  padding: var(--space-md);
}

/* ---- Error / Empty ---- */
.publish-error-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

.publish-empty {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 28px 64px;
}

.publish-empty-card {
  width: min(480px, 100%);
  text-align: center;
  padding: var(--space-xl) var(--space-lg);
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-radius: var(--radius-panel);
  background:
    radial-gradient(ellipse at 50% 0%, rgba(201, 162, 39, 0.06), transparent 55%),
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.005)),
    var(--bg-card);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.22);
}

.publish-empty-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 28px;
  background:
    radial-gradient(circle at 50% 40%, rgba(201,162,39,.16), rgba(201,162,39,.05) 62%, rgba(201,162,39,.02) 100%);
  border: 1px solid rgba(201,162,39,.18);
  box-shadow:
    0 0 28px rgba(201,162,39,.06),
    inset 0 1px 0 rgba(255,255,255,.04);
}

.publish-empty-title {
  margin: 0 0 8px;
  color: #f5f0e8;
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.publish-empty-hint {
  max-width: 400px;
  margin: 0 auto;
  color: #a89f94;
  font-size: 14px;
  line-height: 1.8;
}

.publish-empty-line {
  width: 120px;
  height: 1px;
  margin: 22px auto 0;
  background: linear-gradient(90deg, transparent, rgba(201,162,39,.18), transparent);
}

.publish-empty-card .el-button {
  margin-top: 26px;
}

/* ---- Stale warning ---- */
.publish-stale-card {
  margin-bottom: var(--space-sm);
}

.publish-stale-card p {
  margin: 0 0 var(--space-sm);
}

/* ---- Status bar ---- */
.publish-status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.005)),
    var(--bg-card);
}

.publish-stale-badge {
  color: var(--color-warning);
  font-size: 12px;
  font-weight: 600;
}

.publish-cover-origin {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: auto;
}

/* ---- Grid layout ---- */
.publish-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

@media (max-width: 800px) {
  .publish-grid {
    grid-template-columns: 1fr;
  }
}

.publish-left,
.publish-right {
  display: grid;
  gap: var(--space-md);
  align-content: start;
}

/* ---- Card ---- */
.publish-card {
  border: 1px solid rgba(201, 162, 39, 0.13);
  border-radius: var(--radius-panel);
  background:
    linear-gradient(180deg, rgba(255,255,255,.028), rgba(255,255,255,.006)),
    var(--bg-card);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.publish-card-header {
  padding: var(--space-sm) var(--space-md);
  font-size: 0.9rem;
  font-weight: var(--font-subheading);
  color: #e4c26f;
  border-bottom: 1px solid rgba(201, 162, 39, 0.12);
  background: linear-gradient(180deg, rgba(201, 162, 39, 0.04), rgba(201, 162, 39, 0.01));
}

.publish-card-body {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
}

/* ---- Video ---- */
.publish-video-preview {
  aspect-ratio: 9 / 16;
  max-height: 360px;
  background: #000;
  border-radius: var(--radius-card);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.publish-video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.publish-video-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  color: var(--text-secondary);
}

.publish-video-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: 12px;
  color: var(--text-secondary);
}

.publish-meta-item {
  white-space: nowrap;
}

/* ---- Cover ---- */
.publish-cover-preview {
  aspect-ratio: 9 / 16;
  max-height: 360px;
  background: #000;
  border-radius: var(--radius-card);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.publish-cover-image {
  width: 100%;
  height: 100%;
}

.publish-cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  color: var(--text-secondary);
}

.publish-cover-prompt-section {
  display: grid;
  gap: var(--space-sm);
}

.publish-field-label {
  font-size: 0.84rem;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.publish-cover-prompt-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  align-items: center;
}

.publish-cover-generate-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.publish-cost-label {
  font-size: 11px;
  color: var(--color-warning);
  white-space: nowrap;
}

/* ---- Title candidates ---- */
.publish-selected-title {
  margin-bottom: var(--space-sm);
}

.publish-title-candidates-section {
  display: grid;
  gap: var(--space-sm);
}

.publish-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.publish-candidate-list {
  display: grid;
  gap: var(--space-xs);
}

.publish-candidate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease;
}

.publish-candidate-item:hover {
  border-color: rgba(201, 162, 39, 0.28);
  background: rgba(201, 162, 39, 0.04);
}

.publish-candidate-item.selected {
  border-color: rgba(201, 162, 39, 0.35);
  background: rgba(201, 162, 39, 0.06);
}

.publish-candidate-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-body);
}

.publish-candidate-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.publish-selected-icon {
  color: var(--color-success);
}

.publish-no-candidates {
  padding: var(--space-md);
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* ---- Hashtags ---- */
.publish-hashtag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-height: 32px;
}

.publish-hashtag-chip {
  cursor: default;
}

.publish-no-hashtags {
  color: var(--text-muted);
  font-size: 13px;
}

.publish-hashtag-input {
  max-width: 280px;
}

/* ---- Actions ---- */
.publish-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}

/* ---- Dialogs ---- */
.cost-hint {
  color: var(--text-secondary);
  font-size: 12px;
}

.upload-form {
  display: grid;
  gap: var(--space-sm);
}

.upload-hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}
</style>
