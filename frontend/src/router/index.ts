import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";

import HomePage from "../views/HomePage.vue";
import ProjectWorkspace from "../views/ProjectWorkspace.vue";
import ProjectsPage from "../views/ProjectsPage.vue";

export function createAppRouter(mode: "memory" | "web" = "memory") {
  return createRouter({
    history: mode === "web" ? createWebHistory() : createMemoryHistory(),
    routes: [
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
}
