import { z } from 'zod';
import { GenerationConfigurationV1 } from '../generation/generation-configuration.schema.js';
import { NarrationQualifiedOption } from './narration-model-policy.schema.js';
import { NarrationDurationBand, NarrationTimingMode } from './narration.schema.js';
export const NarrationUiOption = NarrationQualifiedOption.extend({supported_tones:z.array(z.string()).min(1),supported_rates:z.array(z.number().positive()).min(1)});
export const NarrationUiContext = z.object({mode:NarrationTimingMode,source_script_record_id:z.string().nullable(),source_text_sha256:z.string().nullable(),target_duration_band:NarrationDurationBand.nullable(),configuration_revision:z.number().int().nonnegative(),configuration:GenerationConfigurationV1.nullable(),policy_version:z.string(),recommended_provider_model_id:z.string(),recommended_voice_profile_id:z.string(),options:z.array(NarrationUiOption)}).strict();
export type NarrationUiContext = z.infer<typeof NarrationUiContext>;
/** 任务11B 旧项目升级预览：只读，不修改任何项目状态；affected 仅列当前非空下游指针。 */
export const NarrationModeUpgradePreviewV1 = z.object({narration_timing_mode:z.literal('legacy_estimated'),upgrade_available:z.boolean(),policy_version:z.string(),recommended:z.object({provider_model_id:z.string(),voice_profile_id:z.string()}).nullable(),options:z.array(NarrationQualifiedOption),current_configuration:z.object({revision:z.number().int().nonnegative(),tts_mode:z.enum(['auto','fixed']),provider_model_id:z.string().nullable(),voice_profile_id:z.string().nullable()}).strict(),script:z.object({active_script_record_id:z.string().nullable(),estimated_duration_sec:z.number().nullable()}).strict(),affected:z.array(z.object({stage:z.enum(['storyboard','asset_plan','assets','compose','render','publish']),record_id:z.string()}).strict())}).strict();
export type NarrationModeUpgradePreviewV1 = z.infer<typeof NarrationModeUpgradePreviewV1>;
