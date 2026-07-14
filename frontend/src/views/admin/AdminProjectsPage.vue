<template>
  <div class="admin-projects-page">
    <div class="page-header">
      <h2 class="page-title">项目管理</h2>
    </div>

    <el-table :data="projects" v-loading="loading" stripe class="projects-table">
      <el-table-column prop="name" label="项目名称" min-width="160" />
      <el-table-column prop="ownerId" label="Owner ID" min-width="200" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ row.status }}</el-tag>
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
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openTransferDialog(row)">
            转移 Owner
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <div class="empty-state">暂无项目</div>
      </template>
    </el-table>

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
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";

import { apiFetch, ApiError } from "../../utils/api";

interface AdminProject {
  id: string;
  name: string;
  ownerId: string;
  createdById: string;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const loading = ref(false);
const projects = ref<AdminProject[]>([]);

async function loadProjects() {
  loading.value = true;
  try {
    const data = await apiFetch<{ items: AdminProject[] }>("/api/admin/projects");
    projects.value = data.items;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
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
</style>
