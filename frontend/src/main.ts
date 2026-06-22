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
import {
  createFetchAssetsApi,
  createAssetsStore,
  assetsStoreKey,
} from "./stores/assets";
import {
  createFetchComposeApi,
  createComposeStore,
  composeStoreKey,
} from "./stores/compose";
import {
  createFetchRenderApi,
  createRenderStore,
  renderStoreKey,
} from "./stores/render";
import {
  createFetchPublishApi,
  createPublishStore,
  publishStoreKey,
} from "./stores/publish";
import { initTheme } from "./composables/useTheme";

initTheme();

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
const assetsStore = createAssetsStore({
  projectStore,
  api: createFetchAssetsApi(),
});
const composeStore = createComposeStore({
  projectStore,
  api: createFetchComposeApi(),
});
const renderStore = createRenderStore({
  projectStore,
  api: createFetchRenderApi(),
});
const publishStore = createPublishStore({
  projectStore,
  api: createFetchPublishApi(),
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
app.provide(assetsStoreKey, assetsStore);
app.provide(composeStoreKey, composeStore);
app.provide(renderStoreKey, renderStore);
app.provide(publishStoreKey, publishStore);

if (typeof document !== "undefined") {
  app.mount("#app");
}
