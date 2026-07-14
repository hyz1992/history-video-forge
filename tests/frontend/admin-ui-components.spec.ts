// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { nextTick, reactive } from "vue";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createAppRouter } from "../../frontend/src/router";
import { authStoreKey } from "../../frontend/src/stores/auth";
import { createFetchProjectApi, createProjectStore, projectStoreKey } from "../../frontend/src/stores/project";
import { topicStoreKey } from "../../frontend/src/stores/topic";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

import HomePage from "../../frontend/src/views/HomePage.vue";
import AdminLayout from "../../frontend/src/views/admin/AdminLayout.vue";
import AdminUsersPage from "../../frontend/src/views/admin/AdminUsersPage.vue";
import AdminProjectsPage from "../../frontend/src/views/admin/AdminProjectsPage.vue";
import AdminAuditLogsPage from "../../frontend/src/views/admin/AdminAuditLogsPage.vue";
import ProjectWorkspace from "../../frontend/src/views/ProjectWorkspace.vue";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

function makeAuthStore(role: "ADMIN" | "USER" | null) {
  const user =
    role === null
      ? null
      : {
          id: role === "ADMIN" ? "admin-1" : "user-1",
          username: role === "ADMIN" ? "admin" : "user1",
          displayName: role === "ADMIN" ? "管理员" : "用户1",
          role,
          status: "ACTIVE",
          mustChangePassword: false,
          lastLoginAt: "2026-01-01T00:00:00.000Z",
        };

  const state = reactive({
    user: user as any,
    initialized: true,
    loading: false,
  });

  return {
    state: state as Readonly<typeof state>,
    loadMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: () => user !== null,
  };
}

function makeProjectStore(overrides?: { projectOwnerId?: string | null }) {
  const state = reactive({
    projectId: "proj-1",
    projectOwnerId: overrides?.projectOwnerId ?? null,
    currentStatus: "topic_pending",
    publishIsReady: false,
    projects: [],
  });

  return {
    state,
    createProject: vi.fn(),
    ensureProject: vi.fn(),
    deleteProject: vi.fn(),
    loadProject: vi.fn(),
    loadProjects: vi.fn(),
    resolveProjectWorkspacePath: vi.fn(
      (id: string) => `/projects/${id}/topic`,
    ),
    syncProject(snapshot: any) {
      state.projectId = snapshot.project_id;
      state.projectOwnerId = snapshot.owner_id ?? null;
      state.currentStatus = snapshot.current_status;
    },
    setPublishReady: vi.fn(),
  };
}

function makeTopicStoreStub() {
  return {
    state: reactive({ candidates: [], isGenerating: false }),
    generateRecommendations: vi.fn(),
    loadTopic: vi.fn(),
    loadExistingTopic: vi.fn(),
    selectCandidate: vi.fn(),
    confirmTopic: vi.fn(),
    clear: vi.fn(),
  };
}

function makeWorkspaceStoreStub(index = 0) {
  return {
    state: reactive({ currentStepIndex: index }),
    currentStepKey: () => "topic",
    setCurrentStepByKey: vi.fn(),
  };
}

function commonProvide(role: "ADMIN" | "USER" | null, projectOverrides?: { projectOwnerId?: string | null }) {
  const authStore = makeAuthStore(role);
  const router = createAppRouter("memory", { authStore: authStore as any });
  return {
    global: {
      plugins: [ElementPlus, router],
      provide: {
        [authStoreKey as any]: authStore,
        [projectStoreKey as any]: makeProjectStore(projectOverrides),
        [topicStoreKey as any]: makeTopicStoreStub(),
        [workspaceStoreKey as any]: makeWorkspaceStoreStub(),
      },
    },
  };
}

async function waitForRender(wrapper: ReturnType<typeof mount>, ticks = 3) {
  for (let i = 0; i < ticks; i++) {
    await nextTick();
  }
}

function stubIntersectionObserver() {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("admin UI entry points", () => {
  beforeEach(() => {
    stubIntersectionObserver();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HomePage shows admin entry for ADMIN", async () => {
    const wrapper = mount(HomePage, commonProvide("ADMIN"));
    await waitForRender(wrapper);
    const btn = wrapper.find('[data-testid="home-admin-entry"]');
    expect(btn.exists()).toBe(true);
  });

  it("HomePage hides admin entry for USER", async () => {
    const wrapper = mount(HomePage, commonProvide("USER"));
    await waitForRender(wrapper);
    const btn = wrapper.find('[data-testid="home-admin-entry"]');
    expect(btn.exists()).toBe(false);
  });

  it("HomePage hides admin entry for anonymous", async () => {
    const wrapper = mount(HomePage, commonProvide(null));
    await waitForRender(wrapper);
    const btn = wrapper.find('[data-testid="home-admin-entry"]');
    expect(btn.exists()).toBe(false);
  });
});

describe("admin pages render", () => {
  function mountAdminPage(component: any) {
    stubIntersectionObserver();
    const authStore = makeAuthStore("ADMIN");
    const router = createAppRouter("memory", { authStore: authStore as any });
    void router.push("/admin/users");
    return mount(component, {
      global: {
        plugins: [ElementPlus, router],
        provide: {
          [authStoreKey as any]: authStore,
          [projectStoreKey as any]: makeProjectStore(),
          [topicStoreKey as any]: makeTopicStoreStub(),
          [workspaceStoreKey as any]: makeWorkspaceStoreStub(),
        },
      },
    });
  }

  it("AdminLayout renders sidebar navigation", async () => {
    const wrapper = mountAdminPage(AdminLayout);
    await waitForRender(wrapper);
    expect(wrapper.text()).toContain("管理后台");
    expect(wrapper.text()).toContain("用户管理");
    expect(wrapper.text()).toContain("项目管理");
    expect(wrapper.text()).toContain("审计日志");
    expect(wrapper.text()).toContain("返回工作区");
  });

  it("AdminUsersPage renders title and table with data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: "u1",
            username: "testuser",
            displayName: "测试用户",
            role: "USER",
            status: "ACTIVE",
            mustChangePassword: false,
            lastLoginAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            isMigrationOwner: false,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountAdminPage(AdminUsersPage);
    await waitForRender(wrapper, 5);

    expect(wrapper.text()).toContain("用户管理");
    expect(wrapper.text()).toContain("创建用户");
    expect(wrapper.text()).toContain("testuser");
  });

  it("AdminProjectsPage renders title and action buttons", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          {
            id: "p1",
            name: "测试项目",
            ownerId: "u1",
            createdById: "u1",
            status: "script_ready",
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountAdminPage(AdminProjectsPage);
    await waitForRender(wrapper, 5);

    expect(wrapper.text()).toContain("项目管理");
    expect(wrapper.text()).toContain("测试项目");
    expect(wrapper.text()).toContain("查看项目");
    expect(wrapper.text()).toContain("转移");
  });

  it("AdminAuditLogsPage renders title and filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountAdminPage(AdminAuditLogsPage);
    await waitForRender(wrapper, 5);

    expect(wrapper.text()).toContain("审计日志");
    expect(wrapper.text()).toContain("查询");
    expect(wrapper.text()).toContain("重置");
  });
});

describe("deputize banner in ProjectWorkspace", () => {
  beforeEach(() => {
    stubIntersectionObserver();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountWorkspace(role: "ADMIN" | "USER", ownerId: string | null) {
    const authStore = makeAuthStore(role);
    const router = createAppRouter("memory", { authStore: authStore as any });

    return mount(ProjectWorkspace, {
      global: {
        plugins: [ElementPlus, router],
        provide: {
          [authStoreKey as any]: authStore,
          [projectStoreKey as any]: makeProjectStore({ projectOwnerId: ownerId }),
          [topicStoreKey as any]: makeTopicStoreStub(),
          [workspaceStoreKey as any]: makeWorkspaceStoreStub(),
        },
      },
    });
  }

  it("shows deputize banner when ADMIN views another user's project", async () => {
    const wrapper = mountWorkspace("ADMIN", "user-other");
    await waitForRender(wrapper);
    const banner = wrapper.find('[data-testid="deputize-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("代管");
  });

  it("does NOT show deputize banner when ADMIN views own project", async () => {
    const wrapper = mountWorkspace("ADMIN", "admin-1");
    await waitForRender(wrapper);
    const banner = wrapper.find('[data-testid="deputize-banner"]');
    expect(banner.exists()).toBe(false);
  });

  it("does NOT show deputize banner for USER role", async () => {
    const wrapper = mountWorkspace("USER", "user-1");
    await waitForRender(wrapper);
    const banner = wrapper.find('[data-testid="deputize-banner"]');
    expect(banner.exists()).toBe(false);
  });
});

describe("deputize banner via real getProject API flow", () => {
  beforeEach(() => {
    stubIntersectionObserver();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows banner when ADMIN loads project that has different owner_id in API response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        project_id: "proj-other",
        name: "他人的历史项目",
        owner_id: "user-other",
        current_status: "script_ready",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const authStore = makeAuthStore("ADMIN");
    const api = createFetchProjectApi();
    const projectStore = createProjectStore(api);
    const router = createAppRouter("memory", { authStore: authStore as any });
    await router.push("/projects/proj-other/topic");

    const wrapper = mount(ProjectWorkspace, {
      global: {
        plugins: [ElementPlus, router],
        provide: {
          [authStoreKey as any]: authStore,
          [projectStoreKey as any]: projectStore,
          [topicStoreKey as any]: makeTopicStoreStub(),
          [workspaceStoreKey as any]: makeWorkspaceStoreStub(0),
        },
      },
    });

    await waitForRender(wrapper, 5);

    const banner = wrapper.find('[data-testid="deputize-banner"]');
    expect(banner.exists()).toBe(true);
    expect(projectStore.state.projectOwnerId).toBe("user-other");
  });
});
