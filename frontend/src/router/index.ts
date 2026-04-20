import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";

import ScriptPage from "../views/ScriptPage.vue";
import TopicPage from "../views/TopicPage.vue";

export function createAppRouter(mode: "memory" | "web" = "memory") {
  return createRouter({
    history: mode === "web" ? createWebHistory() : createMemoryHistory(),
    routes: [
      {
        path: "/",
        redirect: "/topic",
      },
      {
        path: "/topic",
        component: TopicPage,
      },
      {
        path: "/script",
        component: ScriptPage,
      },
    ],
  });
}
