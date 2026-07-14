<script setup lang="ts">
import { ref, watch, computed } from "vue";

import { useAuthStore } from "../../stores/auth";
import { ApiError } from "../../utils/api";

const authStore = useAuthStore();

const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const errorMessage = ref("");

const showPassword = ref(false);
const showConfirmPassword = ref(false);

const visible = computed(() => authStore.authModal.open);

const isLogin = computed(() => authStore.authModal.mode === "login");

const title = computed(() => (isLogin.value ? "登录" : "注册"));

const canSubmit = computed(() => {
  if (loading.value) return false;
  if (!username.value || !password.value) return false;
  if (!isLogin.value && !confirmPassword.value) return false;
  return true;
});

function switchMode() {
  errorMessage.value = "";
  username.value = "";
  password.value = "";
  confirmPassword.value = "";
  showPassword.value = false;
  showConfirmPassword.value = false;
  authStore.authModal.mode = isLogin.value ? "register" : "login";
}

async function handleSubmit() {
  if (!canSubmit.value) return;
  if (!isLogin.value && password.value !== confirmPassword.value) {
    errorMessage.value = "两次输入的密码不一致";
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  try {
    if (isLogin.value) {
      await authStore.login(username.value, password.value);
    } else {
      await authStore.register(username.value, password.value, username.value);
    }
    const action = authStore.authModal.pendingAction;
    authStore.hideAuthModal();
    if (action) {
      action();
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        errorMessage.value = "用户名或密码错误";
      } else if (error.status === 409) {
        errorMessage.value = "用户名已被注册";
      } else if (error.status === 400) {
        const msgMap: Record<string, string> = {
          register_missing_fields: "请填写所有字段",
          register_invalid_username: "用户名需为 3-30 位字母、数字或下划线",
          register_weak_password: "密码长度需至少 12 位",
          register_username_taken: "用户名已被注册",
        };
        errorMessage.value = msgMap[error.code] ?? error.message;
      } else {
        errorMessage.value = isLogin.value ? "登录失败，请稍后重试" : "注册失败，请稍后重试";
      }
    } else {
      errorMessage.value = isLogin.value ? "登录失败，请稍后重试" : "注册失败，请稍后重试";
    }
  } finally {
    loading.value = false;
  }
}

function close() {
  if (loading.value) return;
  authStore.hideAuthModal();
}

watch(visible, (open) => {
  if (!open) {
    username.value = "";
    password.value = "";
    confirmPassword.value = "";
    showPassword.value = false;
    showConfirmPassword.value = false;
    errorMessage.value = "";
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal-box">
        <button
          v-if="!loading"
          class="modal-close"
          @click="close"
          aria-label="关闭"
        >✕</button>

        <div class="modal-title">{{ title }}</div>
        <p class="modal-subtitle">历史短视频工坊</p>

        <form class="auth-form" @submit.prevent="handleSubmit">
          <label class="auth-field">
            <span class="auth-label">用户名</span>
            <input
              v-model.trim="username"
              class="auth-input"
              type="text"
              autocomplete="username"
              :disabled="loading"
              placeholder="请输入用户名"
            />
          </label>

          <label v-if="!isLogin" class="auth-field">
            <span class="auth-label">确认密码</span>
            <div class="auth-input-wrap">
              <input
                v-model="confirmPassword"
                class="auth-input"
                :type="showConfirmPassword ? 'text' : 'password'"
                :disabled="loading"
                placeholder="请再次输入密码"
              />
              <button
                type="button"
                class="auth-eye-btn"
                @click="showConfirmPassword = !showConfirmPassword"
                :aria-label="showConfirmPassword ? '隐藏密码' : '显示密码'"
                tabindex="-1"
              >
                <svg v-if="showConfirmPassword" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </label>

          <label class="auth-field">
            <span class="auth-label">密码</span>
            <div class="auth-input-wrap">
              <input
                v-model="password"
                class="auth-input"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                :disabled="loading"
                placeholder="请输入密码"
              />
              <button
                type="button"
                class="auth-eye-btn"
                @click="showPassword = !showPassword"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                tabindex="-1"
              >
                <svg v-if="showPassword" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </label>

          <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>

          <button
            class="auth-submit"
            type="submit"
            :disabled="!canSubmit"
          >
            <span v-if="loading" class="btn-spinner"></span>
            {{ loading ? (isLogin ? "登录中..." : "注册中...") : title }}
          </button>
        </form>

        <p class="auth-switch">
          <template v-if="isLogin">
            没有账号？<button class="auth-switch-btn" @click="switchMode">去注册</button>
          </template>
          <template v-else>
            已有账号？<button class="auth-switch-btn" @click="switchMode">去登录</button>
          </template>
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 6, 12, 0.72);
  backdrop-filter: blur(6px);
}

.modal-box {
  position: relative;
  width: 420px;
  max-width: 94vw;
  background: linear-gradient(180deg, #141c2b 0%, var(--bg-card) 120px);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 16px;
  box-shadow:
    0 0 0 1px rgba(212, 163, 95, 0.05),
    0 8px 48px rgba(0, 0, 0, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.3);
  padding: 32px 36px 28px;
}

.modal-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(212, 163, 95, 0.35), transparent);
  border-radius: 0 0 2px 2px;
}

.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
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
  line-height: 1;
  transition: all 200ms ease;
}
.modal-close:hover {
  color: var(--text-heading);
  background: rgba(212, 163, 95, 0.1);
  border-color: rgba(212, 163, 95, 0.3);
}

.modal-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-heading);
  line-height: 1;
  margin-bottom: 4px;
}

.modal-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auth-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.auth-input {
  width: 100%;
  padding: 10px 40px 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: var(--bg-input);
  color: var(--text-body);
  font-size: 14px;
  font-family: var(--font-family);
  outline: none;
  transition: border-color 200ms ease;
}
.auth-input:focus {
  border-color: rgba(212, 163, 95, 0.4);
  box-shadow: 0 0 0 2px rgba(212, 163, 95, 0.08);
}
.auth-input::placeholder {
  color: var(--text-muted);
}

.auth-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.auth-eye-btn {
  position: absolute;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: color 200ms ease;
}
.auth-eye-btn:hover {
  color: var(--text-secondary);
}

.auth-error {
  margin: 0;
  color: var(--color-danger);
  font-size: 13px;
  line-height: 1.5;
}

.auth-submit {
  margin-top: 4px;
  padding: 12px 24px;
  border: none;
  border-radius: 100px;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-family);
  cursor: pointer;
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: var(--text-inverse);
  box-shadow:
    0 4px 16px rgba(212, 163, 95, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 240ms cubic-bezier(0.4, 0, 0.2, 1);
}
.auth-submit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow:
    0 8px 24px rgba(212, 163, 95, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.auth-submit:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(212, 163, 95, 0.2);
}
.auth-submit:disabled {
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

.auth-switch {
  margin-top: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.auth-switch-btn {
  background: none;
  border: none;
  color: var(--accent-primary);
  font-size: 13px;
  font-family: var(--font-family);
  cursor: pointer;
  padding: 0;
}
.auth-switch-btn:hover {
  color: var(--accent-primary-light);
  text-decoration: underline;
}
</style>
