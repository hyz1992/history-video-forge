import { createMemoryHistory, createRouter } from "vue-router";

import ScriptPage from "../views/ScriptPage.vue";
import TopicPage from "../views/TopicPage.vue";

export function createAppRouter() {
  return createRouter({
    history: createMemoryHistory(),
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
