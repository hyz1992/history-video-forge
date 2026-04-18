import { z } from "zod";

export const ScriptDraftPackage = z
  .object({
    script_text: z.string().min(1),
    estimated_duration_sec: z.number().nonnegative(),
    beat_trace: z.array(
      z
        .object({
          beat: z.string().min(1),
          excerpt: z.string().min(1),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
    quote_trace: z.array(
      z
        .object({
          quote: z.string().min(1),
          usage_type: z.enum(["exact", "paraphrase"]),
          excerpt: z.string().min(1),
        })
        .strict(),
    ),
    opening_span: z.string().min(1),
    ending_span: z.string().min(1),
  })
  .strict();

export type ScriptDraftPackage = z.infer<typeof ScriptDraftPackage>;
