<template>
  <div class="admin-library-page">
    <!-- Tabs: 审核队列 | 公共库管理 -->
    <div class="page-tabs">
      <button
        class="page-tab-btn"
        :class="{ 'page-tab-btn--active': activeTab === 'review' }"
        @click="activeTab = 'review'"
      >审核队列</button>
      <button
        class="page-tab-btn"
        :class="{ 'page-tab-btn--active': activeTab === 'entries' }"
        @click="activeTab = 'entries'"
      >公共库管理</button>
    </div>

    <!-- Review Queue -->
    <div v-if="activeTab === 'review'" class="review-section">
      <div class="section-header">
        <h3 class="section-title">待审核草稿</h3>
        <div class="section-header-actions">
          <button class="refresh-btn" @click="loadDrafts" :disabled="draftLoading">刷新</button>
        </div>
      </div>

      <div class="filter-bar">
        <input
          v-model="draftFilters.search"
          class="filter-input"
          placeholder="搜索标题或摘要"
          @keyup.enter="onDraftSearch"
        />
        <select v-model="draftFilters.draftKind" class="filter-select" @change="onDraftSearch">
          <option value="">全部类型</option>
          <option value="recommendation_reflux">推荐回流</option>
          <option value="custom">自定义</option>
        </select>
        <button class="refresh-btn refresh-btn--primary" @click="onDraftSearch">查询</button>
        <button class="refresh-btn" @click="resetDraftFilters">重置</button>
      </div>

      <div v-if="draftLoading" class="section-loading">加载中…</div>
      <div v-else-if="draftError" class="section-error">{{ draftError }}</div>
      <div v-else-if="drafts.length === 0" class="section-empty">
        <p>暂无待审核的草稿</p>
      </div>
      <div v-else class="draft-list">
        <div
          v-for="draft in drafts"
          :key="draft.id"
          class="draft-card"
        >
          <div class="draft-header">
            <span class="draft-title">{{ draft.proposed_title }}</span>
            <span class="draft-kind">{{ draftKindLabel(draft.draft_kind) }}</span>
          </div>
          <p class="draft-summary">{{ draft.proposed_summary }}</p>
          <div class="draft-meta">
            <span>提交者：{{ draft.owner_username || draft.owner_id }}</span>
            <span>{{ formatTime(draft.created_at) }}</span>
          </div>
          <div class="draft-actions">
            <button
              class="action-btn action-btn--approve"
              :disabled="draft.processing"
              @click="approveDraft(draft)"
            >
              {{ draft.processing ? '处理中…' : '通过' }}
            </button>
            <button
              class="action-btn action-btn--reject"
              :disabled="draft.processing"
              @click="openRejectDialog(draft)"
            >
              拒绝
            </button>
          </div>
        </div>
      </div>

      <div v-if="draftTotal > draftPageSize" class="pagination-bar">
        <button class="refresh-btn" :disabled="draftPage <= 1" @click="changeDraftPage(draftPage - 1)">上一页</button>
        <span class="page-info">{{ draftPage }} / {{ Math.ceil(draftTotal / draftPageSize) }}（共 {{ draftTotal }} 条）</span>
        <button class="refresh-btn" :disabled="draftPage * draftPageSize >= draftTotal" @click="changeDraftPage(draftPage + 1)">下一页</button>
      </div>
    </div>

    <!-- Entries Management -->
    <div v-if="activeTab === 'entries'" class="entries-section">
      <div class="section-header">
        <h3 class="section-title">公共库条目</h3>
        <div class="section-header-actions">
          <button class="refresh-btn refresh-btn--success" @click="openCreateDialog">新建</button>
          <button class="refresh-btn" @click="loadEntries" :disabled="entryLoading">刷新</button>
          <button class="refresh-btn refresh-btn--primary" @click="triggerSync" :disabled="syncing">
            {{ syncing ? '同步中…' : '触发同步' }}
          </button>
        </div>
      </div>

      <div class="filter-bar">
        <input
          v-model="entryFilters.search"
          class="filter-input"
          placeholder="搜索标题或摘要"
          @keyup.enter="onEntrySearch"
        />
        <input
          v-model="entryFilters.dynasty"
          class="filter-input filter-input--narrow"
          placeholder="朝代"
          @keyup.enter="onEntrySearch"
        />
        <select v-model="entryFilters.status" class="filter-select" @change="onEntrySearch">
          <option value="">全部状态</option>
          <option value="curated">已收录</option>
          <option value="draft">草稿</option>
          <option value="archived">已归档</option>
        </select>
        <button class="refresh-btn refresh-btn--primary" @click="onEntrySearch">查询</button>
        <button class="refresh-btn" @click="resetEntryFilters">重置</button>
      </div>

      <div v-if="entryLoading" class="section-loading">加载中…</div>
      <div v-else-if="entryError" class="section-error">{{ entryError }}</div>
      <div v-else-if="entries.length === 0" class="section-empty">
        <p>暂无条目</p>
      </div>
      <table v-else class="entries-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>朝代</th>
            <th>状态</th>
            <th>来源</th>
            <th>角度数</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.id">
            <td class="entry-title-cell">{{ entry.canonical_title }}</td>
            <td>{{ entry.dynasty || '-' }}</td>
            <td>
              <span class="status-tag" :class="`status-tag--${entry.status}`">
                {{ entryStatusLabel(entry.status) }}
              </span>
            </td>
            <td>{{ entryOriginLabel(entry.origin_kind) }}</td>
            <td>{{ entry.angle_count }}</td>
            <td>{{ formatTime(entry.updated_at) }}</td>
            <td class="entry-actions-cell">
              <button class="action-btn action-btn--edit" @click="openEditDialog(entry)">编辑</button>
              <button
                class="action-btn action-btn--archive"
                :disabled="entry.status === 'archived'"
                @click="archiveEntry(entry)"
              >归档</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="entryTotal > entryPageSize" class="pagination-bar">
        <button class="refresh-btn" :disabled="entryPage <= 1" @click="changeEntryPage(entryPage - 1)">上一页</button>
        <span class="page-info">{{ entryPage }} / {{ Math.ceil(entryTotal / entryPageSize) }}（共 {{ entryTotal }} 条）</span>
        <button class="refresh-btn" :disabled="entryPage * entryPageSize >= entryTotal" @click="changeEntryPage(entryPage + 1)">下一页</button>
      </div>
    </div>

    <!-- Reject Dialog -->
    <div v-if="rejectTarget" class="reject-overlay" @click.self="rejectTarget = null">
      <div class="reject-dialog">
        <h4 class="reject-title">拒绝草稿</h4>
        <p class="reject-info">草稿：{{ rejectTarget.proposed_title }}</p>
        <textarea
          v-model="rejectNotes"
          class="reject-textarea"
          placeholder="拒绝原因（可选）"
          rows="3"
        ></textarea>
        <div class="reject-actions">
          <button class="action-btn action-btn--cancel" @click="rejectTarget = null">取消</button>
          <button
            class="action-btn action-btn--reject"
            :disabled="rejectProcessing"
            @click="handleReject"
          >
            {{ rejectProcessing ? '处理中…' : '确认拒绝' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit/Create Entry Dialog -->
    <div v-if="editDialogVisible" class="reject-overlay" @click.self="editDialogVisible = false">
      <div class="edit-dialog">
        <h4 class="reject-title">{{ editIsNew ? '新建事件条目' : '编辑事件条目' }}</h4>
        <div class="edit-form">
          <label class="edit-field">
            <span class="edit-label">标题 <span class="required">*</span></span>
            <input v-model="editForm.canonical_title" class="edit-input" placeholder="事件标题" />
          </label>
          <label class="edit-field">
            <span class="edit-label">摘要 <span class="required">*</span></span>
            <textarea v-model="editForm.summary" class="edit-textarea" rows="3" placeholder="事件摘要"></textarea>
          </label>
          <div class="edit-row">
            <label class="edit-field edit-field--half">
              <span class="edit-label">朝代</span>
              <input v-model="editForm.dynasty" class="edit-input" placeholder="如：唐" />
            </label>
            <label class="edit-field edit-field--half">
              <span class="edit-label">时期</span>
              <input v-model="editForm.era" class="edit-input" placeholder="如：初唐" />
            </label>
          </div>
          <label class="edit-field">
            <span class="edit-label">人物标签（逗号分隔）</span>
            <input v-model="editForm.character_tags" class="edit-input" placeholder="如：李世民, 李建成" />
          </label>
          <label class="edit-field">
            <span class="edit-label">事件类型标签（逗号分隔）</span>
            <input v-model="editForm.event_type_tags" class="edit-input" placeholder="如：继承夺位, 武装政变" />
          </label>
          <label class="edit-field">
            <span class="edit-label">可信度</span>
            <select v-model="editForm.credibility_level" class="edit-input">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>
        <div class="reject-actions">
          <button class="action-btn action-btn--cancel" @click="editDialogVisible = false">取消</button>
          <button
            class="action-btn action-btn--approve"
            :disabled="editSaving"
            @click="handleEditSave"
          >
            {{ editSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { apiFetch, ApiError } from "../../utils/api";

const activeTab = ref<"review" | "entries">("review");

// ---- Drafts ----
interface DraftItem {
  id: string;
  draft_kind: string;
  proposed_title: string;
  proposed_summary: string;
  proposed_angles: unknown[];
  proposed_tags: Record<string, unknown>;
  status: string;
  owner_id: string;
  owner_username: string | null;
  created_at: string;
  processing?: boolean;
}

const drafts = ref<DraftItem[]>([]);
const draftLoading = ref(false);
const draftError = ref<string | null>(null);
const draftPage = ref(1);
const draftPageSize = ref(20);
const draftTotal = ref(0);
const draftFilters = reactive({ search: "", draftKind: "" });

function draftKindLabel(kind: string): string {
  if (kind === "recommendation_reflux") return "推荐回流";
  if (kind === "custom") return "自定义";
  return kind;
}

function buildDraftQueryParams(): Record<string, string> {
  const params: Record<string, string> = {
    page: String(draftPage.value),
    page_size: String(draftPageSize.value),
  };
  if (draftFilters.search.trim()) params.search = draftFilters.search.trim();
  if (draftFilters.draftKind) params.draft_kind = draftFilters.draftKind;
  return params;
}

async function loadDrafts() {
  draftLoading.value = true;
  draftError.value = null;
  try {
    const params = new URLSearchParams(buildDraftQueryParams()).toString();
    const data = await apiFetch<{ drafts: DraftItem[]; total: number; page: number; page_size: number }>(
      `/api/admin/event-library/drafts?${params}`,
    );
    drafts.value = data.drafts.map((d) => ({ ...d, processing: false }));
    draftTotal.value = data.total ?? data.drafts.length;
    draftPageSize.value = data.page_size ?? draftPageSize.value;
  } catch (e) {
    draftError.value = e instanceof Error ? e.message : "加载草稿失败";
  } finally {
    draftLoading.value = false;
  }
}

function onDraftSearch() {
  draftPage.value = 1;
  loadDrafts();
}

function resetDraftFilters() {
  draftFilters.search = "";
  draftFilters.draftKind = "";
  draftPage.value = 1;
  loadDrafts();
}

function changeDraftPage(page: number) {
  draftPage.value = page;
  loadDrafts();
}

async function approveDraft(draft: DraftItem) {
  draft.processing = true;
  try {
    const result = await apiFetch<{ entry_id: string; merged: boolean }>(
      `/api/admin/event-library/drafts/${draft.id}/review`,
      { method: "POST", body: { decision: "approve" } },
    );
    ElMessage.success(result.merged ? "已合并到已有条目" : "已创建新条目");
    await loadDrafts();
  } catch (e) {
    if (e instanceof ApiError) {
      ElMessage.error(e.code);
    }
    draft.processing = false;
  }
}

// ---- Reject ----
const rejectTarget = ref<DraftItem | null>(null);
const rejectNotes = ref("");
const rejectProcessing = ref(false);

function openRejectDialog(draft: DraftItem) {
  rejectTarget.value = draft;
  rejectNotes.value = "";
}

async function handleReject() {
  if (!rejectTarget.value || rejectProcessing.value) return;
  rejectProcessing.value = true;
  try {
    await apiFetch(
      `/api/admin/event-library/drafts/${rejectTarget.value.id}/review`,
      {
        method: "POST",
        body: {
          decision: "reject",
          review_notes: rejectNotes.value.trim() || undefined,
        },
      },
    );
    ElMessage.success("已拒绝");
    rejectTarget.value = null;
    await loadDrafts();
  } catch (e) {
    if (e instanceof ApiError) {
      ElMessage.error(e.code);
    }
  } finally {
    rejectProcessing.value = false;
  }
}

// ---- Entries ----
interface AdminEntry {
  id: string;
  canonical_title: string;
  summary: string;
  dynasty: string | null;
  era: string | null;
  status: string;
  visibility: string;
  origin_kind: string;
  angle_count: number;
  character_tags: string[];
  event_type_tags: string[];
  credibility_level: string;
  created_at: string;
  updated_at: string;
}

const entries = ref<AdminEntry[]>([]);
const entryLoading = ref(false);
const entryError = ref<string | null>(null);
const entryPage = ref(1);
const entryPageSize = ref(20);
const entryTotal = ref(0);
const entryFilters = reactive({ search: "", dynasty: "", status: "" });

const ENTRY_STATUS_LABELS: Record<string, string> = {
  curated: "已收录",
  draft: "草稿",
  archived: "已归档",
};
const ENTRY_ORIGIN_LABELS: Record<string, string> = {
  builtin: "内置",
  admin: "管理员",
  draft: "草稿合并",
};

function entryStatusLabel(status: string): string {
  return ENTRY_STATUS_LABELS[status] ?? status;
}
function entryOriginLabel(origin: string): string {
  return ENTRY_ORIGIN_LABELS[origin] ?? origin;
}

function buildEntryQueryParams(): Record<string, string> {
  const params: Record<string, string> = {
    page: String(entryPage.value),
    page_size: String(entryPageSize.value),
  };
  if (entryFilters.search.trim()) params.search = entryFilters.search.trim();
  if (entryFilters.dynasty.trim()) params.dynasty = entryFilters.dynasty.trim();
  if (entryFilters.status) params.status = entryFilters.status;
  return params;
}

async function loadEntries() {
  entryLoading.value = true;
  entryError.value = null;
  try {
    const params = new URLSearchParams(buildEntryQueryParams()).toString();
    const data = await apiFetch<{ entries: AdminEntry[]; total: number; page: number; page_size: number }>(
      `/api/admin/event-library/entries?${params}`,
    );
    entries.value = data.entries;
    entryTotal.value = data.total ?? data.entries.length;
    entryPageSize.value = data.page_size ?? entryPageSize.value;
  } catch (e) {
    entryError.value = e instanceof Error ? e.message : "加载条目失败";
  } finally {
    entryLoading.value = false;
  }
}

function onEntrySearch() {
  entryPage.value = 1;
  loadEntries();
}

function resetEntryFilters() {
  entryFilters.search = "";
  entryFilters.dynasty = "";
  entryFilters.status = "";
  entryPage.value = 1;
  loadEntries();
}

function changeEntryPage(page: number) {
  entryPage.value = page;
  loadEntries();
}

const syncing = ref(false);

async function triggerSync() {
  syncing.value = true;
  try {
    const result = await apiFetch<{ created: number; updated: number; errors: string[] }>(
      "/api/admin/event-library/sync",
      { method: "POST" },
    );
    ElMessage.success(
      `同步完成：新增 ${result.created}，更新 ${result.updated}${result.errors.length ? `，${result.errors.length} 个错误` : ""}`,
    );
    await loadEntries();
  } catch (e) {
    if (e instanceof ApiError) {
      ElMessage.error(e.code);
    }
  } finally {
    syncing.value = false;
  }
}

// ---- Edit / Create Entry ----
interface EditForm {
  canonical_title: string;
  summary: string;
  dynasty: string;
  era: string;
  character_tags: string;
  event_type_tags: string;
  credibility_level: string;
}

const editDialogVisible = ref(false);
const editIsNew = ref(true);
const editSaving = ref(false);
const editEntryId = ref<string | null>(null);

const defaultEditForm = (): EditForm => ({
  canonical_title: "",
  summary: "",
  dynasty: "",
  era: "",
  character_tags: "",
  event_type_tags: "",
  credibility_level: "medium",
});

const editForm = ref<EditForm>(defaultEditForm());

function openCreateDialog() {
  editIsNew.value = true;
  editEntryId.value = null;
  editForm.value = defaultEditForm();
  editDialogVisible.value = true;
}

function openEditDialog(entry: AdminEntry) {
  editIsNew.value = false;
  editEntryId.value = entry.id;
  editForm.value = {
    canonical_title: entry.canonical_title,
    summary: entry.summary,
    dynasty: entry.dynasty || "",
    era: entry.era || "",
    character_tags: (entry.character_tags || []).join(", "),
    event_type_tags: (entry.event_type_tags || []).join(", "),
    credibility_level: entry.credibility_level || "medium",
  };
  editDialogVisible.value = true;
}

function parseCommaList(s: string): string[] {
  return s
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

async function handleEditSave() {
  if (!editForm.value.canonical_title.trim() || !editForm.value.summary.trim()) {
    ElMessage.warning("标题和摘要为必填项");
    return;
  }
  editSaving.value = true;
  try {
    const body = {
      canonicalTitle: editForm.value.canonical_title.trim(),
      summary: editForm.value.summary.trim(),
      dynasty: editForm.value.dynasty.trim() || undefined,
      era: editForm.value.era.trim() || undefined,
      characterTags: parseCommaList(editForm.value.character_tags),
      eventTypeTags: parseCommaList(editForm.value.event_type_tags),
      credibilityLevel: editForm.value.credibility_level,
    };

    if (editIsNew.value) {
      await apiFetch("/api/admin/event-library/entries", { method: "POST", body });
      ElMessage.success("已创建新条目，文件已写入");
    } else {
      await apiFetch(`/api/admin/event-library/entries/${editEntryId.value}`, {
        method: "PATCH",
        body,
      });
      ElMessage.success("已更新条目，文件已写入");
    }

    editDialogVisible.value = false;
    await loadEntries();
  } catch (e) {
    if (e instanceof ApiError) {
      ElMessage.error(e.code);
    }
  } finally {
    editSaving.value = false;
  }
}

async function archiveEntry(entry: AdminEntry) {
  if (!confirm(`确定要归档「${entry.canonical_title}」吗？`)) return;
  try {
    await apiFetch(`/api/admin/event-library/entries/${entry.id}`, { method: "DELETE" });
    ElMessage.success("已归档");
    await loadEntries();
  } catch (e) {
    if (e instanceof ApiError) {
      ElMessage.error(e.code);
    }
  }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(() => {
  loadDrafts();
});

// 切换到"公共库管理" tab 时自动加载条目列表
watch(activeTab, (tab) => {
  if (tab === "entries") {
    loadEntries();
  }
});
</script>

<style scoped>
.admin-library-page {
  max-width: 1000px;
}

.page-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
}

.page-tab-btn {
  padding: 10px 24px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 14px;
  cursor: pointer;
  transition: all 200ms ease;
}
.page-tab-btn:hover {
  border-color: var(--el-color-primary);
}
.page-tab-btn--active {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-header-actions {
  display: flex;
  gap: 8px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.refresh-btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 13px;
  cursor: pointer;
}
.refresh-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.refresh-btn--primary {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}

.section-loading,
.section-empty,
.section-error {
  text-align: center;
  padding: 40px 16px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.section-error {
  color: var(--el-color-danger);
}

/* Draft Cards */
.draft-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.draft-card {
  padding: 16px 20px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}

.draft-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.draft-title {
  font-size: 15px;
  font-weight: 600;
}

.draft-kind {
  font-size: 11px;
  color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
}

.draft-summary {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.draft-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-bottom: 12px;
}

.draft-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 7px 20px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 13px;
  cursor: pointer;
  transition: all 200ms ease;
}
.action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn--approve {
  background: var(--el-color-success);
  color: #fff;
  border-color: var(--el-color-success);
}
.action-btn--reject {
  background: var(--el-color-danger);
  color: #fff;
  border-color: var(--el-color-danger);
}
.action-btn--cancel {
  background: var(--el-bg-color);
}

/* Entries Table */
.entries-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.entries-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid var(--el-border-color-light);
  font-weight: 600;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.entries-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.entry-title-cell {
  font-weight: 500;
}

.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.status-tag--curated {
  background: rgba(103, 194, 58, 0.1);
  color: var(--el-color-success);
}
.status-tag--archived {
  background: rgba(144, 147, 153, 0.1);
  color: var(--el-text-color-placeholder);
}
.status-tag--draft {
  background: rgba(230, 162, 60, 0.1);
  color: var(--el-color-warning);
}

/* Reject Dialog */
.reject-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.reject-dialog {
  width: 420px;
  max-width: 92vw;
  padding: 24px;
  border-radius: 12px;
  background: var(--el-bg-color);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3);
}

.reject-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}

.reject-info {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.reject-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}

.reject-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 14px;
}

/* Edit Dialog */
.edit-dialog {
  width: 520px;
  max-width: 94vw;
  max-height: 85vh;
  overflow-y: auto;
  padding: 24px;
  border-radius: 12px;
  background: var(--el-bg-color);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 16px;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edit-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.required {
  color: var(--el-color-danger);
}

.edit-row {
  display: flex;
  gap: 12px;
}

.edit-field--half {
  flex: 1;
}

.edit-input {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  font-size: 13px;
  font-family: inherit;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  box-sizing: border-box;
}

.edit-textarea {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}

.edit-input:focus,
.edit-textarea:focus {
  outline: none;
  border-color: var(--el-color-primary);
}

/* Entry actions */
.entry-actions-cell {
  display: flex;
  gap: 6px;
}

.action-btn--edit {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}

.action-btn--archive {
  background: var(--el-color-warning);
  color: #fff;
  border-color: var(--el-color-warning);
}

.refresh-btn--success {
  background: var(--el-color-success);
  color: #fff;
  border-color: var(--el-color-success);
}

.filter-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-input {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  font-size: 13px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  box-sizing: border-box;
  min-width: 180px;
}

.filter-input--narrow {
  min-width: 100px;
  max-width: 120px;
}

.filter-select {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
  font-size: 13px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  box-sizing: border-box;
  min-width: 120px;
}

.pagination-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
  padding: 12px 0;
}

.page-info {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
