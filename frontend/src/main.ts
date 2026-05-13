import { createApp, h } from "vue";
import { RouterView } from "vue-router";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";

import "./styles/main.css";
import { createAppRouter } from "./router";
import {
  createFetchProjectApi,
  createProjectStore,
  projectStoreKey,
} from "./stores/project";
import {
  createFetchScriptApi,
  createScriptStore,
  scriptStoreKey,
} from "./stores/script";
import {
  createFetchAssetPlanningApi,
  createAssetPlanningStore,
  assetPlanningStoreKey,
} from "./stores/asset-planning";
import {
  createFetchStoryboardApi,
  createStoryboardStore,
  storyboardStoreKey,
} from "./stores/storyboard";
import {
  createFetchTopicApi,
  createTopicStore,
  topicStoreKey,
} from "./stores/topic";

const router = createAppRouter("web");
const projectStore = createProjectStore(createFetchProjectApi());
const topicStore = createTopicStore({
  projectStore,
  api: createFetchTopicApi(),
});
const scriptStore = createScriptStore({
  projectStore,
  api: createFetchScriptApi(),
});
const storyboardStore = createStoryboardStore({
  projectStore,
  api: createFetchStoryboardApi(),
});
const assetPlanningStore = createAssetPlanningStore({
  projectStore,
  api: createFetchAssetPlanningApi(),
});

const app = createApp({
  render: () => h(RouterView),
});

app.use(ElementPlus);
app.use(router);
app.provide(projectStoreKey, projectStore);
app.provide(topicStoreKey, topicStore);
app.provide(scriptStoreKey, scriptStore);
app.provide(storyboardStoreKey, storyboardStore);
app.provide(assetPlanningStoreKey, assetPlanningStore);

if (typeof document !== "undefined") {
  app.mount("#app");
}
