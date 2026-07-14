<template>
  <div class="admin-users-page">
    <div class="page-header">
      <h2 class="page-title">用户管理</h2>
      <el-button type="primary" @click="openCreateDialog">创建用户</el-button>
    </div>

    <el-table :data="users" v-loading="loading" stripe class="users-table">
      <el-table-column prop="username" label="用户名" min-width="120" />
      <el-table-column prop="displayName" label="显示名" min-width="120" />
      <el-table-column label="角色" width="80">
        <template #default="{ row }">
          <el-tag :type="row.role === 'ADMIN' ? 'danger' : 'info'" size="small">
            {{ row.role }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'warning'" size="small">
            {{ row.status === 'ACTIVE' ? '正常' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="迁移" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.isMigrationOwner" type="warning" size="small">迁移用户</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="lastLoginAt" label="最后登录" width="160">
        <template #default="{ row }">
          {{ row.lastLoginAt ? formatTime(row.lastLoginAt) : "从未登录" }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="340" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button
              v-if="row.status === 'ACTIVE'"
              size="small"
              type="warning"
              :disabled="row.isMigrationOwner"
              @click="confirmDisable(row)"
            >
              停用
            </el-button>
            <el-button
              v-if="row.status === 'DISABLED'"
              size="small"
              type="success"
              @click="confirmEnable(row)"
            >
              启用
            </el-button>
            <el-button
              size="small"
              @click="openResetPassword(row)"
            >
              重置密码
            </el-button>
            <el-button
              size="small"
              type="danger"
              @click="confirmRevokeSessions(row)"
            >
              撤销会话
            </el-button>
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <div class="empty-state">暂无用户</div>
      </template>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="创建用户" width="420px">
      <el-form :model="createForm" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="createForm.username" placeholder="字母、数字、下划线" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="createForm.displayName" placeholder="可选，默认为用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="createForm.password" type="password" placeholder="至少 12 个字符" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role" class="full-width">
            <el-option label="普通用户" value="USER" />
            <el-option label="管理员" value="ADMIN" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showResetDialog" title="重置密码" width="400px">
      <p class="reset-info">正在为用户 <strong>{{ resetTarget?.username }}</strong> 重置密码</p>
      <el-input v-model="resetPassword" type="password" placeholder="新密码（至少 12 个字符）" show-password />
      <template #footer>
        <el-button @click="showResetDialog = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="handleResetPassword">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { apiFetch, ApiError } from "../../utils/api";

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  isMigrationOwner: boolean;
}

const loading = ref(false);
const users = ref<AdminUser[]>([]);

async function loadUsers() {
  loading.value = true;
  try {
    const data = await apiFetch<{ items: AdminUser[] }>("/api/admin/users");
    users.value = data.items;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadUsers();
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

const showCreateDialog = ref(false);
const creating = ref(false);
const createForm = reactive({
  username: "",
  displayName: "",
  password: "",
  role: "USER" as "ADMIN" | "USER",
});

function openCreateDialog() {
  createForm.username = "";
  createForm.displayName = "";
  createForm.password = "";
  createForm.role = "USER";
  showCreateDialog.value = true;
}

async function handleCreate() {
  if (!createForm.username.trim() || !createForm.password) {
    ElMessage.warning("用户名和密码不能为空");
    return;
  }
  creating.value = true;
  try {
    await apiFetch("/api/admin/users", {
      method: "POST",
      body: {
        username: createForm.username.trim(),
        displayName: createForm.displayName.trim() || undefined,
        password: createForm.password,
        role: createForm.role,
      },
    });
    showCreateDialog.value = false;
    ElMessage.success("用户创建成功");
    await loadUsers();
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    } else {
      ElMessage.error("创建失败");
    }
  } finally {
    creating.value = false;
  }
}

async function confirmDisable(user: AdminUser) {
  try {
    await ElMessageBox.confirm(
      `停用后用户"${user.displayName}"将立即无法登录，确认？`,
      "停用用户",
      { confirmButtonText: "确认停用", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  try {
    await apiFetch(`/api/admin/users/${user.id}/disable`, { method: "POST" });
    ElMessage.success("用户已停用");
    await loadUsers();
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    }
  }
}

async function confirmEnable(user: AdminUser) {
  try {
    await apiFetch(`/api/admin/users/${user.id}/enable`, { method: "POST" });
    ElMessage.success("用户已启用");
    await loadUsers();
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    }
  }
}

const showResetDialog = ref(false);
const resetTarget = ref<AdminUser | null>(null);
const resetPassword = ref("");
const resetting = ref(false);

function openResetPassword(user: AdminUser) {
  resetTarget.value = user;
  resetPassword.value = "";
  showResetDialog.value = true;
}

async function handleResetPassword() {
  if (!resetPassword.value || !resetTarget.value) {
    ElMessage.warning("请输入新密码");
    return;
  }
  resetting.value = true;
  try {
    await apiFetch(`/api/admin/users/${resetTarget.value.id}/reset-password`, {
      method: "POST",
      body: { password: resetPassword.value },
    });
    showResetDialog.value = false;
    ElMessage.success("密码已重置，用户需重新登录");
    await loadUsers();
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    }
  } finally {
    resetting.value = false;
  }
}

async function confirmRevokeSessions(user: AdminUser) {
  try {
    await ElMessageBox.confirm(
      `将撤销用户"${user.displayName}"的所有活动会话，确认？`,
      "撤销会话",
      { confirmButtonText: "确认撤销", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  try {
    const data = await apiFetch<{ revokedCount: number }>(
      `/api/admin/users/${user.id}/sessions/revoke`,
      { method: "POST" },
    );
    ElMessage.success(`已撤销 ${data.revokedCount} 个会话`);
  } catch (error) {
    if (error instanceof ApiError) {
      ElMessage.error(error.code);
    }
  }
}
</script>

<style scoped>
.admin-users-page {
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
.users-table {
  width: 100%;
}
.action-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.full-width {
  width: 100%;
}
.reset-info {
  margin: 0 0 12px;
  font-size: 14px;
}
</style>
