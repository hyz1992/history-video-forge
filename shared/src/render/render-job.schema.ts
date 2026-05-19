import { z } from "zod";

export const RenderJobStatus = z.enum([
  "queued",
  "rendering",
  "completed",
  "failed",
  "stale_source",
]);

export const ExportArtifact = z
  .object({
    artifact_id: z.string().min(1),
    artifact_type: z.literal("rendered_video"),
    file_uri: z.string().min(1),
    mime_type: z.literal("video/mp4"),
    duration_sec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    source_compose_record_id: z.string().min(1),
    source_asset_manifest_record_id: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RenderJobStatus = z.infer<typeof RenderJobStatus>;
export type ExportArtifact = z.infer<typeof ExportArtifact>;
