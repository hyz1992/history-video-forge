import { z } from 'zod';
import { GenerationConfigurationV1 } from '../generation/generation-configuration.schema.js';
import { NarrationQualifiedOption } from './narration-model-policy.schema.js';
import { NarrationDurationBand, NarrationTimingMode } from './narration.schema.js';
export const NarrationUiOption = NarrationQualifiedOption.extend({supported_tones:z.array(z.string()).min(1),supported_rates:z.array(z.number().positive()).min(1)});
export const NarrationUiContext = z.object({mode:NarrationTimingMode,source_script_record_id:z.string().nullable(),source_text_sha256:z.string().nullable(),target_duration_band:NarrationDurationBand.nullable(),configuration_revision:z.number().int().nonnegative(),configuration:GenerationConfigurationV1.nullable(),policy_version:z.string(),recommended_provider_model_id:z.string(),recommended_voice_profile_id:z.string(),options:z.array(NarrationUiOption)}).strict();
export type NarrationUiContext = z.infer<typeof NarrationUiContext>;
