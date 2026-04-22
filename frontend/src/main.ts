import { createApp, h } from "vue";
import { RouterView } from "vue-router";

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

const app = createApp({
  render: () => h(RouterView),
});

app.use(router);
app.provide(projectStoreKey, projectStore);
app.provide(topicStoreKey, topicStore);
app.provide(scriptStoreKey, scriptStore);

if (typeof document !== "undefined") {
  app.mount("#app");
}
