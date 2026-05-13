import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";

import AssetPlanningPage from "../views/AssetPlanningPage.vue";
import HomePage from "../views/HomePage.vue";
import ProjectWorkspace from "../views/ProjectWorkspace.vue";
import ProjectsPage from "../views/ProjectsPage.vue";
import ScriptPage from "../views/ScriptPage.vue";
import StoryboardPage from "../views/StoryboardPage.vue";
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
        path: "/projects/:projectId",
        component: ProjectWorkspace,
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
        path: "/projects/:projectId/storyboard",
        component: StoryboardPage,
      },
      {
        path: "/projects/:projectId/asset-plan",
        component: AssetPlanningPage,
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
