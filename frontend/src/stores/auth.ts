import { reactive, readonly, inject, type InjectionKey } from "vue";

import { apiFetch, ApiError, onUnauthorized } from "../utils/api";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
  status: string;
  mustChangePassword: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  initialized: boolean;
  loading: boolean;
}

export interface AuthStore {
  state: Readonly<AuthState>;
  loadMe: () => Promise<AuthUser | null>;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<AuthUser>;
  clear: () => void;
  isAuthenticated: () => boolean;
  authModal: { open: boolean; mode: "login" | "register"; pendingAction: (() => void) | null };
  openAuthModal: (mode?: "login" | "register") => void;
  openAuthModalForAction: (action: () => void) => void;
  hideAuthModal: () => void;
}

export const authStoreKey: InjectionKey<AuthStore> = Symbol("auth-store");

export function createAuthStore(): AuthStore {
  const state = reactive<AuthState>({
    user: null,
    initialized: false,
    loading: false,
  });

  function clear() {
    state.user = null;
  }

  async function loadMe(): Promise<AuthUser | null> {
    state.loading = true;
    try {
      const data = await apiFetch<{ user?: AuthUser }>("/api/auth/me");
      if (data?.user) {
        state.user = data.user;
        return data.user;
      }
      state.user = null;
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        state.user = null;
        return null;
      }
      state.user = null;
      throw error;
    } finally {
      state.loading = false;
      state.initialized = true;
    }
  }

  async function login(username: string, password: string): Promise<AuthUser> {
    state.loading = true;
    try {
      const data = await apiFetch<{ user?: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      if (!data?.user) {
        throw new ApiError(401, "auth_failed", "auth_failed");
      }
      state.user = data.user;
      return data.user;
    } finally {
      state.loading = false;
      state.initialized = true;
    }
  }

  async function register(username: string, password: string, displayName: string): Promise<AuthUser> {
    state.loading = true;
    try {
      const data = await apiFetch<{ user?: AuthUser }>("/api/auth/register", {
        method: "POST",
        body: { username, password, displayName },
      });
      if (!data?.user) {
        throw new ApiError(400, "register_failed", "register_failed");
      }
      state.user = data.user;
      return data.user;
    } finally {
      state.loading = false;
      state.initialized = true;
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // even if logout request fails, clear local state
    } finally {
      state.user = null;
      state.initialized = true;
    }
  }

  function isAuthenticated(): boolean {
    return state.user !== null;
  }

  onUnauthorized(() => {
    clear();
  });

  const authModal = reactive<{
    open: boolean;
    mode: "login" | "register";
    pendingAction: (() => void) | null;
  }>({
    open: false,
    mode: "login",
    pendingAction: null,
  });

  function openAuthModal(mode: "login" | "register" = "login") {
    authModal.mode = mode;
    authModal.open = true;
  }

  function openAuthModalForAction(action: () => void) {
    authModal.pendingAction = action;
    authModal.mode = "login";
    authModal.open = true;
  }

  function hideAuthModal() {
    authModal.open = false;
    authModal.pendingAction = null;
  }

  return {
    state: readonly(state),
    loadMe,
    login,
    logout,
    register,
    clear,
    isAuthenticated,
    authModal,
    openAuthModal,
    openAuthModalForAction,
    hideAuthModal,
  };
}

export function useAuthStore(): AuthStore {
  const store = inject(authStoreKey);
  if (!store) {
    throw new Error("auth_store_missing");
  }
  return store;
}
