<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">登录</h1>
      <p class="login-subtitle">历史短视频工坊</p>

      <form class="login-form" @submit.prevent="handleSubmit">
        <label class="login-field">
          <span class="login-label">用户名</span>
          <input
            v-model.trim="username"
            class="login-input"
            type="text"
            autocomplete="username"
            :disabled="loading"
            data-testid="login-username"
          />
        </label>

        <label class="login-field">
          <span class="login-label">密码</span>
          <input
            v-model="password"
            class="login-input"
            type="password"
            autocomplete="current-password"
            :disabled="loading"
            data-testid="login-password"
          />
        </label>

        <p v-if="errorMessage" class="login-error" data-testid="login-error">{{ errorMessage }}</p>

        <button
          class="login-submit"
          type="submit"
          :disabled="loading || !username || !password"
          data-testid="login-submit"
        >
          {{ loading ? "登录中..." : "登录" }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import { useAuthStore } from "../stores/auth";
import { ApiError } from "../utils/api";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const username = ref("");
const password = ref("");
const loading = ref(false);
const errorMessage = ref("");

function resolveRedirect(): string {
  const redirect = route.query.redirect;
  if (typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")) {
    return redirect;
  }
  return "/";
}

async function handleSubmit() {
  if (!username.value || !password.value) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    await authStore.login(username.value, password.value);
    await router.push(resolveRedirect());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      errorMessage.value = "用户名或密码错误";
    } else {
      errorMessage.value = "登录失败，请稍后重试";
    }
  } finally {
    loading.value = false;
  }
}

void ElMessage;
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #eaeaea;
}
.login-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 40px 36px;
  width: 360px;
  backdrop-filter: blur(8px);
}
.login-title {
  margin: 0 0 4px;
  font-size: 26px;
  font-weight: 600;
  text-align: center;
}
.login-subtitle {
  margin: 0 0 28px;
  font-size: 13px;
  color: #9aa0a6;
  text-align: center;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.login-label {
  font-size: 13px;
  color: #c0c4cc;
}
.login-input {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.25);
  color: #eaeaea;
  font-size: 14px;
  outline: none;
}
.login-input:focus {
  border-color: #409eff;
}
.login-error {
  margin: 0;
  color: #f56c6c;
  font-size: 13px;
}
.login-submit {
  margin-top: 8px;
  padding: 11px 16px;
  border: none;
  border-radius: 6px;
  background: #409eff;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.2s;
}
.login-submit:disabled {
  background: #3a4a6b;
  cursor: not-allowed;
}
.login-submit:not(:disabled):hover {
  background: #66b1ff;
}
</style>
