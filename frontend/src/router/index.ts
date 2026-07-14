import { createMemoryHistory, createRouter, createWebHistory, type Router } from "vue-router";

import HomePage from "../views/HomePage.vue";
import LoginPage from "../views/LoginPage.vue";
import ProjectWorkspace from "../views/ProjectWorkspace.vue";
import ProjectsPage from "../views/ProjectsPage.vue";
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
      },
      {
        path: "/projects",
        component: ProjectsPage,
      },
      {
        path: "/projects/:projectId/:step",
        component: ProjectWorkspace,
      },
      {
        path: "/projects/:projectId",
        component: ProjectWorkspace,
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
        return {
          path: "/login",
          query: { redirect: to.fullPath },
        };
      }

      return true;
    });
  }

  return router;
}
