import { z } from "zod";

import {
  TOPIC_SCRIPT_GRAPH_NODE_NAMES,
  type TopicScriptGraphNodeName,
} from "./graph-node-contract.js";

export const TOPIC_SCRIPT_GRAPH_STATE_FIELDS = [
  "node_name",
  "input_ref",
  "output_ref",
  "failure_reason",
  "patch_used",
  "regenerate_used",
] as const;

const TopicScriptGraphNodeNameSchema = z.enum(TOPIC_SCRIPT_GRAPH_NODE_NAMES);

export const TopicScriptGraphStateSchema = z.object({
  node_name: TopicScriptGraphNodeNameSchema.nullable(),
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  failure_reason: z.string().nullable(),
  patch_used: z.boolean(),
  regenerate_used: z.boolean(),
});

export type TopicScriptGraphState = z.infer<typeof TopicScriptGraphStateSchema>;

export function createTopicScriptGraphState(
  seed?: Partial<TopicScriptGraphState>,
): TopicScriptGraphState {
  return TopicScriptGraphStateSchema.parse({
    node_name: null,
    input_ref: null,
    output_ref: null,
    failure_reason: null,
    patch_used: false,
    regenerate_used: false,
    ...seed,
  });
}

export function createNodeStateUpdate(
  nodeName: TopicScriptGraphNodeName,
  seed?: Partial<TopicScriptGraphState>,
): Partial<TopicScriptGraphState> {
  return TopicScriptGraphStateSchema.partial().parse({
    node_name: nodeName,
    ...seed,
  });
}
