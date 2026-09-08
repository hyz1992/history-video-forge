import { apiFetch } from '../utils/api';
import { createMemoryHistory, createRouter, createWebHistory, type Router } from "vue-router";

import HomePage from "../views/HomePage.vue";
import LoginPage from "../views/LoginPage.vue";
import ProjectWorkspace from "../views/ProjectWorkspace.vue";
import ProjectsPage from "../views/ProjectsPage.vue";
import SettingsPage from "../views/SettingsPage.vue";
import AdminLayout from "../views/admin/AdminLayout.vue";
import AdminUsersPage from "../views/admin/AdminUsersPage.vue";
import AdminProjectsPage from "../views/admin/AdminProjectsPage.vue";
import AdminAuditLogsPage from "../views/admin/AdminAuditLogsPage.vue";
import EventLibraryAdmin from "../views/admin/EventLibraryAdmin.vue";
import type { AuthStore } from "../stores/auth";

export interface CreateRouterOptions {
  authStore: AuthStore;
}

export function createAppRouter(mode: "memory" | "web" = "memory", options?: CreateRouterOptions): Router {
  const router = createRouter({
    history: mode === "web" ? createWebHistory() : createMemoryHistory(),
    routes: [
      {
        path: "/login",
        name: "login",
        component: LoginPage,
        meta: { public: true },
      },
      {
        path: "/",
        component: HomePage,
        meta: { public: true },
      },
      {
        path: "/projects",
        component: ProjectsPage,
      },
      {
        path: "/settings",
        name: "user-generation-settings",
        component: SettingsPage,
      },
      {
        path: "/projects/:projectId/:step",
        component: ProjectWorkspace,
      },
      {
        path: "/projects/:projectId",
        component: ProjectWorkspace,
      },
      {
        path: "/admin",
        component: AdminLayout,
        meta: { requiresAdmin: true },
        children: [
          {
            path: "",
            redirect: "/admin/users",
          },
          {
            path: "users",
            name: "admin-users",
            component: AdminUsersPage,
          },
          {
            path: "projects",
            name: "admin-projects",
            component: AdminProjectsPage,
          },
          {
            path: "audit-logs",
            name: "admin-audit-logs",
            component: AdminAuditLogsPage,
          },
          {
            path: "event-library",
            name: "admin-event-library",
            component: EventLibraryAdmin,
          },
        ],
      },
    ],
  });

  const authStore = options?.authStore;

  if (authStore) {
    router.beforeEach((to) => {
      if (to.meta.public) {
        if (to.path === "/login" && authStore.isAuthenticated()) {
          return { path: "/" };
        }
        return true;
      }

      if (!authStore.isAuthenticated()) {
        authStore.openAuthModal("login");
        return { path: "/" };
      }

      if (to.meta.requiresAdmin) {
        if (authStore.state.user?.role !== "ADMIN") {
          return { path: "/" };
        }
      }

      return true;
    });
  }

  router.beforeResolve(async(to)=>{
    const step=to.params.step,projectId=to.params.projectId;
    if(typeof projectId!=="string"||!["storyboard","asset","compose-render","publish"].includes(String(step)))return true;
    try{const snapshot=await apiFetch<Record<string,any>>("/api/projects/"+encodeURIComponent(projectId));
      if(snapshot.narration_timing_mode==="narration_first_v1"&&snapshot.narration_readiness?.ready!==true){
        const existing=step==="storyboard"?snapshot.active_storyboard:step==="asset"?snapshot.active_assets:step==="compose-render"?(snapshot.active_compose??snapshot.active_render):snapshot.active_publish_package;
        if(!existing)return {path:"/projects/"+encodeURIComponent(projectId)+"/script",query:{reason:"narration_required"}};
      }
    }catch{/* API生成入口仍执行权威门禁，网络失败由页面提供重试。 */}
    return true;
  });
  return router;
}
