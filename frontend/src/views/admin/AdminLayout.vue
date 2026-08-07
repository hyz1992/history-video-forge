<template>
  <div class="admin-layout">
    <el-container class="admin-container">
      <el-aside width="200px" class="admin-sidebar">
        <div class="admin-sidebar-title">管理后台</div>
        <div class="admin-sidebar-back">
          <el-button text size="small" @click="goHome">← 返回工作区</el-button>
        </div>
        <el-menu
          :default-active="activeMenu"
          router
          class="admin-menu"
          background-color="transparent"
        >
          <el-menu-item index="/admin/users">
            <span>用户管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/projects">
            <span>项目管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/audit-logs">
            <span>审计日志</span>
          </el-menu-item>
          <el-menu-item index="/admin/event-library">
            <span>事件库管理</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const activeMenu = computed(() => route.path);

function goHome() {
  router.push("/");
}
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--el-bg-color-page, #f5f7fa);
  color: var(--el-text-color-primary, #303133);
}
.admin-container {
  min-height: 100vh;
}
.admin-sidebar {
  background: var(--el-bg-color, #fff);
  border-right: 1px solid var(--el-border-color-light, #e4e7ed);
  display: flex;
  flex-direction: column;
  padding-top: 0;
}
.admin-sidebar-title {
  padding: 20px 16px 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  border-bottom: 1px solid var(--el-border-color-light, #e4e7ed);
}
.admin-menu {
  flex: 1;
  border-right: none;
}
.admin-sidebar-back {
  padding: 4px 12px 8px;
  border-bottom: 1px solid var(--el-border-color-light, #e4e7ed);
}
.admin-main {
  padding: 24px;
  background: var(--el-bg-color-page, #f5f7fa);
}
</style>
