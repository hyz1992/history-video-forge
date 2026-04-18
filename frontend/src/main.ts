import { createApp, h } from "vue";
import { RouterView } from "vue-router";

import { createAppRouter } from "./router";
import {
  createFetchProjectApi,
  createProjectStore,
  projectStoreKey,
} from "./stores/project";
import {
  createFetchTopicApi,
  createTopicStore,
  topicStoreKey,
} from "./stores/topic";

const router = createAppRouter();
const projectStore = createProjectStore(createFetchProjectApi());
const topicStore = createTopicStore({
  projectStore,
  api: createFetchTopicApi(),
});

const app = createApp({
  render: () => h(RouterView),
});

app.use(router);
app.provide(projectStoreKey, projectStore);
app.provide(topicStoreKey, topicStore);

if (typeof document !== "undefined") {
  app.mount("#app");
}
