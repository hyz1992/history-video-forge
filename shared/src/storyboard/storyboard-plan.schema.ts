import { z } from "zod";
import { StoryboardPlanV1 } from "./storyboard-plan-v1.schema.js";
import { StoryboardPlanV2 } from "./storyboard-plan-v2.schema.js";
export { StoryboardSegment, StoryboardPlanV1 } from "./storyboard-plan-v1.schema.js";
export { StoryboardPlanV2, StoryboardSegmentV2 } from "./storyboard-plan-v2.schema.js";
/** 固定版本联合；v2字段缺失不能作为v1读取。 */
export const StoryboardPlan = z.union([StoryboardPlanV1, StoryboardPlanV2]);
export type StoryboardPlan = z.infer<typeof StoryboardPlan>;
export const VersionedStoryboardPlan = StoryboardPlan;
export type VersionedStoryboardPlan = StoryboardPlan;
