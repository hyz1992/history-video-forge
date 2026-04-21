import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";

import HomePage from "../views/HomePage.vue";
import ProjectsPage from "../views/ProjectsPage.vue";
import ScriptPage from "../views/ScriptPage.vue";
import TopicPage from "../views/TopicPage.vue";

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
        path: "/projects/:projectId/topic",
        component: TopicPage,
      },
      {
        path: "/projects/:projectId/script",
        component: ScriptPage,
      },
      {
        path: "/topic",
        redirect: "/projects",
      },
      {
        path: "/script",
        redirect: "/projects",
      },
    ],
  });
}
