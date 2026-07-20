import { z } from "zod";

/** LLM custom-refine 的结构化输出 */
export const CustomRefinedEvent = z
  .object({
    canonicalName: z.string().min(1).max(30),
    summary: z.string().min(20).max(100),
    dynasty: z.string().min(1),
    characterTags: z.array(z.string().min(1).max(5)).min(1),
    eventTypeTags: z.array(z.string().min(1)).min(1),
    era: z.string().optional(),
    conflictTypeTags: z.array(z.string().min(1)).optional(),
    sourceUncertainty: z.string().optional(),
    ambiguityNotes: z.string().optional(),
  })
  .strict();

export type CustomRefinedEvent = z.infer<typeof CustomRefinedEvent>;
