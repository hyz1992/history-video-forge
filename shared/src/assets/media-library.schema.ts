import { z } from "zod";

export const MediaLibraryLicense = z
  .object({
    license_type: z.enum([
      "cc0",
      "public_domain",
      "royalty_free",
      "owned",
      "provider_generated",
    ]),
    commercial_use_allowed: z.boolean(),
    attribution_required: z.boolean(),
    attribution_text: z.string().min(1).optional(),
    source_url: z.string().url().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.attribution_required && !value.attribution_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attribution_text is required when attribution is required",
        path: ["attribution_text"],
      });
    }
  });

export const MediaLibraryItem = z
  .object({
    library_item_id: z.string().min(1),
    type: z.enum(["sfx", "bgm"]),
    file_uri: z.string().min(1),
    mime_type: z.string().min(1),
    duration_sec: z.number().positive(),
    loopable: z.boolean(),
    tags: z.array(z.string().min(1)),
    mood_tags: z.array(z.string().min(1)),
    license: MediaLibraryLicense,
    file_hash: z.string().min(1),
    imported_at: z.string().datetime(),
    approved_for_use: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.approved_for_use && !value.license.commercial_use_allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approved media library items must allow commercial use",
        path: ["approved_for_use"],
      });
    }
  });

export type MediaLibraryLicense = z.infer<typeof MediaLibraryLicense>;
export type MediaLibraryItem = z.infer<typeof MediaLibraryItem>;
