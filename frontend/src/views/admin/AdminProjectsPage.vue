<template>
  <div class="admin-projects-page">
    <div class="page-header">
      <h2 class="page-title">项目管理<span v-if="ownerFilter" class="filter-hint">（按所有者筛选）</span></h2>
      <el-button v-if="ownerFilter" @click="clearOwnerFilter">查看全部项目</el-button>
    </div>

    <el-form inline class="filters">
      <el-form-item label="搜索">
        <el-input
          v-model="filters.search"
          placeholder="项目名称"
          clearable
          style="width: 220px"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" placeholder="全部" clearable style="width: 150px" @change="onSearch">
          <el-option label="选题中" value="topic" />
          <el-option label="文案阶段" value="script" />
          <el-option label="分镜阶段" value="storyboard" />
          <el-option label="资产阶段" value="asset" />
          <el-option label="合成渲染" value="render" />
          <el-option label="已归档" value="archived" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="projects" v-loading="loading" stripe class="projects-table">
      <el-table-column prop="name" label="项目名称" min-width="200" show-overflow-tooltip />
      <el-table-column label="所有者" min-width="140">
        <template #default="{ row }">
          <el-tooltip :content="row.ownerId" placement="top" :disabled="!row.ownerId">
            <span>{{ row.ownerDisplayName || row.ownerUsername || row.ownerId.slice(0, 8) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag size="small" :type="statusTagType(row.status, row.archivedAt)">
            {{ statusLabel(row.status, row.archivedAt) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="160">
        <template #default="{ row }">
          {{ formatTime(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button size="small" type="primary" @click="viewProject(row)">
              查看项目
            </el-button>
            <el-button size="small" @click="openTransferDialog(row)">
              转移
            </el-button>
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <div class="empty-state">暂无项目</div>
      </template>
    </el-table>

    <div class="pagination-bar">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="loadProjects"
      />
    </div>

    <el-dialog v-model="showTransferDialog" title="转移项目 Owner" width="460px">
      <p class="transfer-info">
        正在转移项目 <strong>{{ transferTarget?.name }}</strong><br />
        当前 Owner：<code>{{ transferTarget?.ownerId }}</code>
      </p>
      <el-form label-position="top">
        <el-form-item label="目标用户 ID">
          <el-input v-model="transferUserId" placeholder="请输入目标用户的 ID" />
        </el-form-item>
        <el-form-item label="转移原因">
          <el-input v-model="transferReason" type="textarea" :rows="2" placeholder="可选，用于审计记录" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showTransferDialog = false">取消</el-button>
        <el-button type="primary" :loading="transferring" @click="handleTransfer">确认转移</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { apiFetch, ApiError } from "../../utils/api";

interface AdminProject {
  id: string;
  name: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  createdById: string;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Array<{ prefix: string; label: string; tagType: "" | "success" | "info" | "warning" | "danger" }> = [
  { prefix: "topic", label: "选题中", tagType: "info" },
  { prefix: "script", label: "文案阶段", tagType: "info" },
  { prefix: "storyboard", label: "分镜阶段", tagType: "warning" },
  { prefix: "asset_plan", label: "资产规划", tagType: "warning" },
  { prefix: "assets", label: "素材生成", tagType: "warning" },
  { prefix: "compos", label: "合成中", tagType: "warning" },
  { prefix: "render", label: "合成渲染", tagType: "success" },
  { prefix: "publish", label: "发布交付", tagType: "success" },
];

function statusLabel(status: string, archivedAt: string | null): string {
  if (archivedAt) return "已归档";
  const found = STATUS_LABELS.find((s) => status.startsWith(s.prefix));
  if (found) {
    if (status.includes("blocked")) return `${found.label}（阻塞）`;
    if (status.includes("ready")) return `${found.label}（就绪）`;
    if (status.includes("completed")) return `${found.label}（完成）`;
    return found.label;
  }
  return status;
}

function statusTagType(status: string, archivedAt: string | null): "" | "success" | "info" | "warning" | "danger" {
  if (archivedAt) return "info";
  if (status.includes("blocked")) return "danger";
  const found = STATUS_LABELS.find((s) => status.startsWith(s.prefix));
  return found ? found.tagType : "info";
}

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const projects = ref<AdminProject[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(20);

const ownerFilter = ref<string>("");
const filters = reactive({
  search: "",
  status: "",
});

const ownerFilterFromRoute = computed(() => {
  const v = route.query.owner_id;
  return typeof v === "string" && v.length > 0 ? v : "";
});

function syncOwnerFromRoute() {
  ownerFilter.value = ownerFilterFromRoute.value;
}

watch(() => route.query.owner_id, () => {
  syncOwnerFromRoute();
  currentPage.value = 1;
  loadProjects();
});

function resolveProjectStep(status: string): string {
  if (status.startsWith("topic")) return "topic";
  if (status.startsWith("script")) return "script";
  if (status.startsWith("storyboard")) return "storyboard";
  if (status.startsWith("asset_plan") || status.startsWith("assets")) return "asset";
  if (status.startsWith("compos") || status.startsWith("render")) return "compose-render";
  if (status.startsWith("publish")) return "publish";
  return "topic";
}

function viewProject(project: AdminProject) {
  const step = resolveProjectStep(project.status);
  router.push(
    `/projects/${project.id}/${step}?admin_view=1&owner_id=${encodeURIComponent(project.ownerId)}`,
  );
}

function buildQueryString(): string {
  const params = new URLSearchParams();
  params.set("limit", String(pageSize.value));
  params.set("offset", String((currentPage.value - 1) * pageSize.value));
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) {
    params.set("status", filters.status);
    if (filters.status === "archived") params.set("include_archived", "1");
  }
  if (ownerFilter.value) params.set("owner_id", ownerFilter.value);
  return params.toString();
}

async function loadProjects() {
  loading.value = true;
  try {
    const data = await apiFetch<{ items: AdminProject[]; total: number }>(
      `/api/admin/projects?${buildQueryString()}`,
    );
    projects.value = data.items;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  currentPage.value = 1;
  loadProjects();
}

function resetFilters() {
  filters.search = "";
  filters.status = "";
  currentPage.value = 1;
  loadProjects();
}

function clearOwnerFilter() {
  router.push("/admin/projects");
}

onMounted(() => {
  syncOwnerFromRoute();
  loadProjects();
});

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

const showTransferDialog = ref(false);
const transferTarget = ref<AdminProject | null>(null);
const transferUserId = ref("");
const transferReason = ref("");
const transferring = ref(false);

function openTransferDialog(project: AdminProject) {
  transferTarget.value = project;
  transferUserId.value = "";
  transferReason.value = "";
  showTransferDialog.value = true;
}

async function handleTransfer() {
  if (!transferUserId.value.trim() || !transferTarget.value) {
    ElMessage.warning("请输入目标用户 ID");
    return;
  }
  transferring.value = true;
  try {
    await apiFetch(`/api/admin/projects/${transferTarget.value.id}/transfer-owner`, {
      method: "POST",
      body: {
        targetUserId: transferUserId.value.trim(),
        reason: transferReason.value.trim() || undefined,
      },
    });
    showTransferDialog.value = false;
    ElMessage.success("项目 Owner 已转移");
    await loadProjects();
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    }
  } finally {
    transferring.value = false;
  }
}
</script>

<style scoped>
.admin-projects-page {
  max-width: 1200px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.filter-hint {
  font-size: 14px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
  margin-left: 8px;
}
.filters {
  margin-bottom: 16px;
}
.projects-table {
  width: 100%;
}
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.transfer-info {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.8;
}
.transfer-info code {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.action-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.pagination-bar {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
