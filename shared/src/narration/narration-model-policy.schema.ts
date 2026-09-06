import { z } from "zod";
export const NarrationSelection = z.object({
    provider_model_id: z.string().min(1),
    voice_profile_id: z.string().min(1),
    policy_version: z.string().min(1),
}).strict();
export type NarrationSelection = z.infer<typeof NarrationSelection>;
export const NarrationPolicyBasis = z.object({
    policy_version: z.string().min(1),
    selection_reason: z.enum(["recommended_auto", "qualified_fixed", "explicit_selection"]),
    qualification_report: z.string().min(1),
}).strict();
export type NarrationPolicyBasis = z.infer<typeof NarrationPolicyBasis>;
export const NarrationQualifiedOption = z.object({
    provider_model_id: z.string().min(1),
    voice_profile_id: z.string().min(1),
    model: z.string().min(1),
    voice: z.string().min(1),
    region: z.literal("cn-beijing"),
    protocol: z.literal("dashscope_ws"),
    parameters_version: z.string().min(1),
}).strict();
export const NarrationFirstModelPolicyV1 = z.object({
    schema_version: z.literal("narration_first_model_policy_v1"),
    policy_version: z.string().min(1),
    qualification_report: z.string().min(1),
    default_provider_model_id: z.string().min(1),
    default_voice_profile_id: z.string().min(1),
    qualified_options: z.array(NarrationQualifiedOption).min(1),
}).strict();
export type NarrationFirstModelPolicyV1 = z.infer<typeof NarrationFirstModelPolicyV1>;
export const NarrationSelectionError = z.object({
    error: z.enum(["narration_selection_required", "narration_policy_changed", "narration_creation_context_changed", "narration_mode_unavailable"]),
    reason: z.string().min(1),
    policy_version: z.string().min(1),
    options: z.array(NarrationQualifiedOption),
}).strict();
export type NarrationSelectionError = z.infer<typeof NarrationSelectionError>;
