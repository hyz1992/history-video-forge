<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { apiFetch } from "../../utils/api";
import { useTopicStore } from "../../stores/topic";
import { useProjectStore } from "../../stores/project";

const emit = defineEmits<{
  (e: "close"): void;
}>();

const topicStore = useTopicStore();
const projectStore = useProjectStore();

// Filters
const dynastyFilter = ref("");
const characterTagFilter = ref("");
const eventTypeTagFilter = ref("");
const searchQuery = ref("");
const dynasties = ref<string[]>([]);

// Pagination
const page = ref(1);
const pageSize = 20;
const total = ref(0);

// Entries
interface LibraryEntry {
  id: string;
  canonical_title: string;
  summary: string;
  dynasty: string | null;
  era: string | null;
  character_tags: string[];
  event_type_tags: string[];
  conflict_type_tags: string[];
  theme_motifs: string[];
  credibility_level: string;
  angle_count: number;
}

const entries = ref<LibraryEntry[]>([]);
const loading = ref(false);
const generating = ref(false);
const error = ref<string | null>(null);

// Detail
interface Angle {
  id: string;
  angle_label: string;
  family_label: string;
  scope_label: string;
}

interface EntryDetail {
  id: string;
  canonical_title: string;
  summary: string;
  dynasty: string | null;
  era: string | null;
  character_tags: string[];
  event_type_tags: string[];
  conflict_type_tags: string[];
  theme_motifs: string[];
  time_range: { start: string; end: string; display: string } | null;
  location_tags: string[];
  relationship_tags: string[];
  source_anchor_refs: string[];
  credibility_level: string;
  dispute_notes: string | null;
  origin_kind: string;
  angles: Angle[];
}

const selectedEntry = ref<EntryDetail | null>(null);
const selectedAngleId = ref<string>("");
const detailLoading = ref(false);

async function loadDynasties() {
  try {
    const data = await apiFetch<{ dynasties: string[] }>("/api/event-library/dynasties");
    dynasties.value = data.dynasties;
  } catch {
    // Silently fail
  }
}

async function loadEntries() {
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams();
    if (dynastyFilter.value) params.set("dynasty", dynastyFilter.value);
    if (characterTagFilter.value) params.set("character_tag", characterTagFilter.value);
    if (eventTypeTagFilter.value) params.set("event_type_tag", eventTypeTagFilter.value);
    if (searchQuery.value) params.set("q", searchQuery.value);
    params.set("page", String(page.value));
    params.set("page_size", String(pageSize));

    const data = await apiFetch<{
      entries: LibraryEntry[];
      total: number;
    }>(`/api/event-library/entries?${params.toString()}`);

    entries.value = data.entries;
    total.value = data.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载事件库失败";
  } finally {
    loading.value = false;
  }
}

async function openDetail(entry: LibraryEntry) {
  detailLoading.value = true;
  selectedAngleId.value = "";
  try {
    const data = await apiFetch<EntryDetail>(
      `/api/event-library/entries/${entry.id}`,
    );
    selectedEntry.value = data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载事件详情失败";
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  selectedEntry.value = null;
}

async function handleGenerate() {
  if (!selectedEntry.value || generating.value) return;
  generating.value = true;
  error.value = null;
  try {
    await projectStore.createProject();
    await projectStore.ensureProject();
    topicStore.selectTab("library");
    // fire-and-forget：store 立即设 isGenerating=true，组件立即跳转到 loading 页
    topicStore.generateFromLibrary(
      selectedEntry.value.id,
      selectedAngleId.value || undefined,
    );
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "生成选题失败";
  } finally {
    generating.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  loadEntries();
}

function handlePageChange(newPage: number) {
  page.value = newPage;
  loadEntries();
}

watch(dynastyFilter, () => {
  page.value = 1;
  loadEntries();
});

watch(characterTagFilter, () => {
  page.value = 1;
  loadEntries();
});

watch(eventTypeTagFilter, () => {
  page.value = 1;
  loadEntries();
});

onMounted(() => {
  loadDynasties();
  loadEntries();
});
</script>

<template>
  <div class="library-browser">
    <!-- Filters -->
    <div class="browser-filters">
      <div class="filter-row">
        <select v-model="dynastyFilter" class="filter-select">
          <option value="">全部朝代</option>
          <option v-for="d in dynasties" :key="d" :value="d">{{ d }}</option>
        </select>
        <input
          v-model="characterTagFilter"
          type="text"
          placeholder="人物标签…"
          class="filter-tag-input"
          @keyup.enter="handleSearch"
        />
        <input
          v-model="eventTypeTagFilter"
          type="text"
          placeholder="事件类型标签…"
          class="filter-tag-input"
          @keyup.enter="handleSearch"
        />
        <div class="search-box">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索事件标题或摘要…"
            class="search-input"
            @keyup.enter="handleSearch"
          />
          <button class="search-btn" @click="handleSearch">搜索</button>
        </div>
      </div>
    </div>

    <!-- Entry List -->
    <div v-if="loading" class="browser-loading">加载中…</div>
    <div v-else-if="error" class="browser-error">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="browser-empty">
      <div class="empty-icon">📚</div>
      <p>暂无匹配的事件库条目</p>
    </div>
    <div v-else class="entry-list">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="entry-card"
        @click="openDetail(entry)"
      >
        <div class="entry-header">
          <span class="entry-title">{{ entry.canonical_title }}</span>
          <span v-if="entry.dynasty" class="entry-dynasty">{{ entry.dynasty }}</span>
        </div>
        <p class="entry-summary">{{ entry.summary }}</p>
        <div class="entry-tags">
          <span
            v-for="tag in (entry.event_type_tags || []).slice(0, 3)"
            :key="tag"
            class="entry-tag"
          >{{ tag }}</span>
          <span class="entry-angle-count">{{ entry.angle_count }} 个角度</span>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="total > pageSize" class="browser-pagination">
      <button
        class="page-btn"
        :disabled="page <= 1"
        @click="handlePageChange(page - 1)"
      >上一页</button>
      <span class="page-info">{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
      <button
        class="page-btn"
        :disabled="page >= Math.ceil(total / pageSize)"
        @click="handlePageChange(page + 1)"
      >下一页</button>
    </div>

    <!-- Detail Drawer -->
    <div v-if="selectedEntry" class="detail-overlay" @click.self="closeDetail">
      <div class="detail-drawer">
        <button class="detail-close" @click="closeDetail">✕</button>

        <div v-if="detailLoading" class="detail-loading">加载详情…</div>
        <template v-else>
          <h3 class="detail-title">{{ selectedEntry.canonical_title }}</h3>

          <div class="detail-meta">
            <span v-if="selectedEntry.dynasty" class="detail-meta-item">
              朝代：{{ selectedEntry.dynasty }}
            </span>
            <span v-if="selectedEntry.era" class="detail-meta-item">
              时期：{{ selectedEntry.era }}
            </span>
            <span class="detail-meta-item">
              可信度：{{ selectedEntry.credibility_level }}
            </span>
          </div>

          <p class="detail-summary">{{ selectedEntry.summary }}</p>

          <div v-if="selectedEntry.angles.length > 0" class="detail-angles">
            <h4 class="detail-section-title">可选角度</h4>
            <div class="angle-list">
              <label
                v-for="angle in selectedEntry.angles"
                :key="angle.id"
                class="angle-option"
                :class="{ 'angle-option--selected': selectedAngleId === angle.id }"
              >
                <input
                  v-model="selectedAngleId"
                  type="radio"
                  :value="angle.id"
                  name="selectedAngle"
                />
                <span class="angle-label">{{ angle.angle_label }}</span>
                <span class="angle-family">{{ angle.family_label }}</span>
              </label>
            </div>
          </div>

          <div v-if="selectedEntry.event_type_tags.length > 0" class="detail-tags">
            <h4 class="detail-section-title">标签</h4>
            <div class="tag-list">
              <span v-for="tag in selectedEntry.event_type_tags" :key="tag" class="detail-tag">
                {{ tag }}
              </span>
            </div>
          </div>

          <div class="detail-actions">
            <button
              class="action-btn action-btn--primary"
              :disabled="generating"
              @click="handleGenerate"
            >
              <span v-if="generating" class="btn-spinner"></span>
              {{ generating ? '生成中…' : '⚡ 生成选题' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.library-browser {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.browser-filters {
  padding: 0;
}

.filter-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.filter-select {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--bg-input);
  color: var(--text-body);
  font-size: 13px;
  font-family: var(--font-family);
  cursor: pointer;
}

.filter-tag-input {
  width: 130px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--bg-input);
  color: var(--text-body);
  font-size: 13px;
  font-family: var(--font-family);
}

.filter-tag-input::placeholder {
  color: var(--text-muted);
}

.search-box {
  display: flex;
  flex: 1;
  gap: 6px;
}

.search-input {
  flex: 1;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--bg-input);
  color: var(--text-body);
  font-size: 13px;
  font-family: var(--font-family);
}

.search-btn {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid rgba(212, 163, 95, 0.3);
  background: rgba(212, 163, 95, 0.08);
  color: var(--accent-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 200ms ease;
}
.search-btn:hover {
  background: rgba(212, 163, 95, 0.16);
}

.browser-loading,
.browser-empty,
.browser-error {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.empty-icon { font-size: 42px; margin-bottom: 8px; opacity: 0.5; }

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
}

.entry-card {
  padding: 14px 18px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 180ms ease;
}
.entry-card:hover {
  border-color: rgba(212, 163, 95, 0.2);
  background: rgba(212, 163, 95, 0.04);
}

.entry-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.entry-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-heading);
}

.entry-dynasty {
  font-size: 11px;
  color: var(--accent-primary);
  background: rgba(212, 163, 95, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.entry-summary {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.entry-tags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.entry-tag {
  font-size: 11px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px;
  border-radius: 4px;
}

.entry-angle-count {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.browser-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.page-btn {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--bg-input);
  color: var(--text-body);
  font-size: 12px;
  cursor: pointer;
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 12px;
  color: var(--text-muted);
}

/* Detail Drawer */
.detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(4, 6, 12, 0.6);
  display: flex;
  justify-content: flex-end;
}

.detail-drawer {
  width: 480px;
  max-width: 92vw;
  height: 100vh;
  overflow-y: auto;
  background: #141c2b;
  border-left: 1px solid rgba(212, 163, 95, 0.12);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-close {
  align-self: flex-end;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-default);
  border-radius: 50%;
  font-size: 14px;
  color: var(--text-muted);
  cursor: pointer;
}

.detail-loading {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}

.detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-heading);
  line-height: 1.3;
}

.detail-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-meta-item {
  font-size: 12px;
  color: var(--text-muted);
}

.detail-summary {
  margin: 0;
  font-size: 14px;
  color: var(--text-body);
  line-height: 1.7;
}

.detail-section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.detail-angles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.angle-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.angle-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 180ms ease;
}
.angle-option:hover {
  border-color: rgba(212, 163, 95, 0.2);
}
.angle-option--selected {
  border-color: rgba(212, 163, 95, 0.4);
  background: rgba(212, 163, 95, 0.06);
}

.angle-label {
  font-size: 14px;
  color: var(--text-heading);
  font-weight: 500;
}

.angle-family {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}

.detail-tags {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tag-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.detail-tag {
  font-size: 11px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 10px;
  border-radius: 4px;
}

.detail-actions {
  margin-top: auto;
  padding-top: 16px;
}

.action-btn {
  width: 100%;
  padding: 14px 24px;
  border-radius: 100px;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-family);
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-btn--primary {
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: var(--text-inverse);
  box-shadow: 0 4px 16px rgba(212, 163, 95, 0.25);
}
.action-btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(212, 163, 95, 0.35);
}
.action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
