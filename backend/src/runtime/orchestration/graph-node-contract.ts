export const TOPIC_SCRIPT_GRAPH_NODE_NAMES = [
  "script-generate",
  "local-validate",
  "semantic-review",
  "patch-once",
  "regen-once",
] as const;

export type TopicScriptGraphNodeName =
  (typeof TOPIC_SCRIPT_GRAPH_NODE_NAMES)[number];

export interface TopicScriptGraphNodeContract {
  nodeName: TopicScriptGraphNodeName;
  consumesExistingRuntimeServices: true;
}

export const TOPIC_SCRIPT_GRAPH_NODE_CONTRACTS: TopicScriptGraphNodeContract[] =
  TOPIC_SCRIPT_GRAPH_NODE_NAMES.map((nodeName) => ({
    nodeName,
    consumesExistingRuntimeServices: true,
  }));
