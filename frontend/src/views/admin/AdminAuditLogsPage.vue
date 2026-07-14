<template>
  <div class="admin-audit-page">
    <div class="page-header">
      <h2 class="page-title">审计日志</h2>
    </div>

    <el-form inline class="audit-filters">
      <el-form-item label="操作者">
        <el-input v-model="filters.actorUserId" placeholder="User ID" clearable style="width: 200px" />
      </el-form-item>
      <el-form-item label="操作类型">
        <el-select v-model="filters.action" placeholder="全部" clearable style="width: 180px">
          <el-option label="创建用户" value="user_create" />
          <el-option label="停用用户" value="user_disable" />
          <el-option label="启用用户" value="user_enable" />
          <el-option label="重置密码" value="user_password_reset" />
          <el-option label="撤销会话" value="session_revoke" />
          <el-option label="转移 Owner" value="owner_transfer" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="logs" v-loading="loading" stripe class="audit-table">
      <el-table-column label="时间" width="160">
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作者" width="200">
        <template #default="{ row }">
          {{ row.actorUserId || "系统" }}
        </template>
      </el-table-column>
      <el-table-column prop="action" label="操作" width="140">
        <template #default="{ row }">
          <el-tag size="small">{{ actionLabel(row.action) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="目标" width="200">
        <template #default="{ row }">
          {{ row.targetType }} {{ row.targetId ? `(${row.targetId.slice(0, 8)}...)` : "" }}
        </template>
      </el-table-column>
      <el-table-column label="详情" min-width="200">
        <template #default="{ row }">
          <code class="audit-metadata">{{ formatMetadata(row.metadataJson) }}</code>
        </template>
      </el-table-column>
      <template #empty>
        <div class="empty-state">暂无审计日志</div>
      </template>
    </el-table>

    <div class="audit-pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="search"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";

import { apiFetch } from "../../utils/api";

interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  projectId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadataJson: unknown;
  createdAt: string;
}

const loading = ref(false);
const logs = ref<AuditLogRecord[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(50);

const filters = reactive({
  actorUserId: "",
  action: "",
});

const ACTION_LABELS: Record<string, string> = {
  user_create: "创建用户",
  user_disable: "停用用户",
  user_enable: "启用用户",
  user_password_reset: "重置密码",
  session_revoke: "撤销会话",
  owner_transfer: "转移 Owner",
  admin_bootstrap: "初始管理员",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function formatMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return String(metadata);
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
    second: "2-digit",
  });
}

async function search() {
  loading.value = true;
  try {
    const data = await apiFetch<{ items: AuditLogRecord[]; total: number }>(
      "/api/admin/audit-logs/query",
      {
        method: "POST",
        body: {
          actorUserId: filters.actorUserId || undefined,
          action: filters.action || undefined,
          limit: pageSize.value,
          offset: (currentPage.value - 1) * pageSize.value,
        },
      },
    );
    logs.value = data.items;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.actorUserId = "";
  filters.action = "";
  currentPage.value = 1;
  search();
}

onMounted(() => {
  search();
});
</script>

<style scoped>
.admin-audit-page {
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
.audit-filters {
  margin-bottom: 16px;
}
.audit-table {
  width: 100%;
}
.audit-metadata {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.audit-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
</style>
