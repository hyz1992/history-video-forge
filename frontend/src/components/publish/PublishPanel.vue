<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ElAlert,
  ElButton,
  ElCard,
  ElDialog,
  ElEmpty,
  ElIcon,
  ElImage,
  ElInput,
  ElMessage,
  ElSkeleton,
  ElTag,
  ElTooltip,
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
import { useRouter } from "vue-router";

const publishStore = usePublishStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const router = useRouter();

const RENDER_STEP_INDEX = PIPELINE_STEPS.findIndex((s) => s.key === "render");

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
    ai_generated: "AI 生成",
  };
  return map[coverOrigin.value] ?? coverOrigin.value;
});

const coverPrompt = computed({
  get: () => pkg.value?.package.cover_prompt_draft ?? "",
  set: (val: string) => {
    publishStore.updatePackage({ cover_prompt_draft: val });
  },
});

const titleCandidates = computed(() => pkg.value?.package.title_candidates ?? []);
const selectedTitle = computed({
  get: () => pkg.value?.package.selected_title ?? "",
  set: (val: string) => {
    publishStore.updatePackage({ selected_title: val });
  },
});

const description = computed({
  get: () => pkg.value?.package.description ?? "",
  set: (val: string) => {
    publishStore.updatePackage({ description: val });
  },
});

const hashtags = computed(() => pkg.value?.package.hashtags ?? []);

const readiness = computed(() => pkg.value?.package.readiness ?? "draft");

const readinessLabel = computed(() => {
  const map: Record<string, string> = {
    draft: "草稿",
    ready: "就绪",
    blocked: "阻塞",
  };
  return map[readiness.value] ?? readiness.value;
});

const readinessType = computed(() => {
  if (readiness.value === "ready") return "success";
  if (readiness.value === "blocked") return "danger";
  return "info";
});

/* -------------------------------------------------------------------------- */
/*  Dialog state                                                              */
/* -------------------------------------------------------------------------- */

const showCoverGenerateConfirm = ref(false);
const showCoverUploadDialog = ref(false);
const coverUploadUri = ref("");
const coverUploadMime = ref("image/png");

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
    standard: "",
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
  await publishStore.generatePackage();
  if (!publishStore.state.loadError) {
    ElMessage.success("发布包已生成");
  }
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
  await publishStore.generateCover();
  if (!publishStore.state.loadError) {
    ElMessage.success("封面图生成已提交");
  }
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

async function handleMarkReady() {
  await publishStore.updatePackage({ readiness: "ready" });
  ElMessage.success("发布包已标记为就绪");
}

function goToRender() {
  workspaceStore.setCurrentStep(RENDER_STEP_INDEX);
  const pid = projectStore.state.projectId;
  if (pid) router.push(`/projects/${pid}/render`);
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                 */
/* -------------------------------------------------------------------------- */

onMounted(() => {
  publishStore.loadProject();
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

    <!-- Loading -->
    <el-skeleton
      v-else-if="publishStore.state.isLoading && !hasPkg"
      :rows="5"
      animated
    />

    <!-- No package: generate -->
    <div v-else-if="!hasPkg" class="publish-empty">
      <el-empty description="尚未生成发布包">
        <el-button
          type="primary"
          :loading="publishStore.state.isGenerating"
          @click="handleGenerate"
        >
          生成发布包
        </el-button>
      </el-empty>
    </div>

    <!-- Main content -->
    <template v-else>
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
        <span v-if="isStale" class="stale-badge">过期</span>
        <span class="cover-origin">封面来源：{{ coverOriginLabel }}</span>
        <el-button
          v-if="readiness !== 'ready'"
          type="success"
          size="small"
          @click="handleMarkReady"
        >
          标记为就绪
        </el-button>
      </div>

      <div class="publish-grid">
        <!-- Left: Video + Cover -->
        <div class="publish-left">
          <!-- Cover section -->
          <el-card class="cover-card" header="封面图">
            <div class="cover-preview">
              <el-image
                v-if="coverArtifact?.file_uri"
                :src="coverArtifact.file_uri"
                fit="contain"
                class="cover-image"
              >
                <template #error>
                  <div class="cover-placeholder">
                    <el-icon :size="48"><Picture /></el-icon>
                    <span>封面预览不可用</span>
                  </div>
                </template>
              </el-image>
              <div v-else class="cover-placeholder">
                <el-icon :size="48"><Picture /></el-icon>
                <span>暂无封面图</span>
              </div>
            </div>

            <!-- Cover prompt editor -->
            <div class="cover-prompt-section">
              <label class="field-label">封面提示词</label>
              <el-input
                v-model="coverPrompt"
                type="textarea"
                :rows="3"
                placeholder="输入封面图提示词..."
              />
              <div class="cover-prompt-actions">
                <el-button
                  size="small"
                  :icon="MagicStick"
                  :loading="publishStore.state.isOptimizingCover"
                  @click="handleOptimizeCover"
                >
                  LLM 优化
                </el-button>
                <el-tooltip
                  content="AI 生成封面图将消耗 DashScope 资源，产生费用"
                  placement="top"
                >
                  <el-button
                    size="small"
                    type="primary"
                    :icon="MagicStick"
                    :loading="publishStore.state.isGeneratingCover"
                    @click="confirmGenerateCover"
                  >
                    AI 生成封面
                  </el-button>
                </el-tooltip>
                <el-button
                  size="small"
                  :icon="Upload"
                  @click="showCoverUploadDialog = true"
                >
                  上传封面
                </el-button>
              </div>
            </div>
          </el-card>
        </div>

        <!-- Right: Title + Description + Hashtags -->
        <div class="publish-right">
          <!-- Title section -->
          <el-card class="title-card" header="标题">
            <div class="selected-title">
              <el-input
                v-model="selectedTitle"
                placeholder="选择或输入标题..."
                maxlength="30"
                show-word-limit
              />
            </div>

            <div class="title-candidates-section">
              <div class="section-header">
                <span class="field-label">标题候选</span>
                <el-button
                  size="small"
                  :icon="Refresh"
                  :loading="isLoadingCandidates"
                  @click="handleLoadTitleCandidates"
                >
                  生成候选
                </el-button>
              </div>

              <div v-if="allCandidates.length > 0" class="candidate-list">
                <div
                  v-for="c in allCandidates"
                  :key="c.candidate_id"
                  class="candidate-item"
                  :class="{ selected: selectedTitle === c.text }"
                  @click="selectTitle(c)"
                >
                  <div class="candidate-text">{{ c.text }}</div>
                  <div class="candidate-meta">
                    <el-tag :type="styleType(c.style)" size="small">
                      {{ styleLabel(c.style) }}
                    </el-tag>
                    <el-icon v-if="selectedTitle === c.text" class="selected-icon">
                      <Check />
                    </el-icon>
                  </div>
                </div>
              </div>
              <div v-else class="no-candidates">
                <span>点击"生成候选"获取 LLM 标题建议</span>
              </div>
            </div>
          </el-card>

          <!-- Description section -->
          <el-card class="description-card" header="描述">
            <el-input
              v-model="description"
              type="textarea"
              :rows="5"
              maxlength="500"
              show-word-limit
              placeholder="输入视频描述..."
            />
          </el-card>

          <!-- Hashtags section -->
          <el-card class="hashtag-card" header="话题标签">
            <div class="hashtag-list">
              <el-tag
                v-for="tag in hashtags"
                :key="tag"
                closable
                class="hashtag-chip"
                @close="removeHashtag(tag)"
              >
                #{{ tag }}
              </el-tag>
              <span v-if="hashtags.length === 0" class="no-hashtags">
                暂无标签
              </span>
            </div>
            <div class="hashtag-input">
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
          </el-card>
        </div>
      </div>

      <!-- Bottom actions -->
      <div class="publish-bottom-actions">
        <el-button
          type="primary"
          :loading="publishStore.state.isGenerating"
          @click="handleGenerate"
        >
          重新生成发布信息
        </el-button>
        <el-button
          type="success"
          disabled
        >
          导出发布包（待实现）
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
      <p><strong>每次生成会产生费用</strong>，是否继续？</p>
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
        <label class="field-label">文件 URI</label>
        <el-input v-model="coverUploadUri" placeholder="file://storage/uploads/cover.png" />
        <label class="field-label">MIME 类型</label>
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
  </div>
</template>

<style scoped>
.publish-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg);
  max-width: 960px;
  margin: 0 auto;
}

.publish-error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-md);
  padding-top: var(--space-2xl);
}

.publish-empty {
  padding-top: var(--space-2xl);
}

.publish-stale-card {
  margin-bottom: var(--space-sm);
}

.publish-stale-card p {
  margin: 0 0 var(--space-sm);
}

.publish-status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.stale-badge {
  color: var(--color-warning, #e6a23c);
  font-size: 12px;
  font-weight: 600;
}

.cover-origin {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: auto;
}

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
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* Cover */
.cover-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.cover-preview {
  aspect-ratio: 9 / 16;
  max-height: 360px;
  background: var(--bg-card, #1a1a2e);
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-image {
  width: 100%;
  height: 100%;
}

.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  color: var(--text-secondary);
}

.cover-prompt-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
  margin-bottom: 4px;
}

.cover-prompt-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* Title */
.selected-title {
  margin-bottom: var(--space-md);
}

.title-candidates-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.candidate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.candidate-item:hover {
  border-color: var(--accent-text);
}

.candidate-item.selected {
  border-color: var(--accent-text);
  background: var(--bg-hover, rgba(64, 158, 255, 0.08));
}

.candidate-text {
  font-size: 14px;
  font-weight: 500;
}

.candidate-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.selected-icon {
  color: var(--color-success, #67c23a);
}

.no-candidates {
  padding: var(--space-md);
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Hashtags */
.hashtag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  min-height: 32px;
}

.hashtag-chip {
  cursor: default;
}

.no-hashtags {
  color: var(--text-secondary);
  font-size: 13px;
}

.hashtag-input {
  max-width: 280px;
}

/* Bottom actions */
.publish-bottom-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-md) 0;
}

/* Dialogs */
.cost-hint {
  color: var(--text-secondary);
  font-size: 12px;
}

.upload-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.upload-hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}
</style>
