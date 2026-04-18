import { createMemoryHistory, createRouter } from "vue-router";

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
    ],
  });
}
