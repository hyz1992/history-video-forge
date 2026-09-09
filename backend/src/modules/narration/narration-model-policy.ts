import { NarrationFirstModelPolicyV1, NarrationSelection, type NarrationSelectionError, GenerationConfigurationV1, type VoiceProfile, } from "../../../../shared/src/index.js";
import type { DbClient, ProviderModelCatalogRecord } from "../../db/client.js";
import { getVoiceProfileById } from "../assets/voice/voice-profile.repository.js";
import { checkNarrationExecutionCompatibility } from "./narration-execution-compatibility.js";
/** 任务0冻结的样例工程资格；不改变全局默认，不授予额外语气/参数资格。 */
export const NARRATION_FIRST_MODEL_POLICY_V1 = NarrationFirstModelPolicyV1.parse({
    schema_version: "narration_first_model_policy_v1",
    policy_version: "narration-first-qwen-neutral-20260906-v1",
    qualification_report: "docs/records/2026-09-06-narration-engineering-qualification.md",
    default_provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus",
    default_voice_profile_id: "voice_narration_qwen_longyimuling",
    qualified_options: [{
            provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus",
            voice_profile_id: "voice_narration_qwen_longyimuling",
            model: "qwen-audio-3.0-tts-plus", voice: "qwen-audio-3.0-tts-plus-longyimuling",
            region: "cn-beijing", protocol: "dashscope_ws", parameters_version: "neutral-pcm24k-v1",
        }],
});
export class NarrationPolicyError extends Error {
    constructor(readonly statusCode: 409 | 422, readonly body: NarrationSelectionError) {
        super(body.error);
    }
}
export function narrationPolicyError(code: NarrationSelectionError["error"], reason: string, policy = NARRATION_FIRST_MODEL_POLICY_V1): NarrationPolicyError {
    return new NarrationPolicyError(code === "narration_selection_required" ? 422 : 409, {
        error: code, reason, policy_version: policy.policy_version, options: structuredClone(policy.qualified_options),
    });
}
function availableNarrationPolicy(policy: NarrationFirstModelPolicyV1, catalog: ProviderModelCatalogRecord[], voices: VoiceProfile[]): NarrationFirstModelPolicyV1 {
    // 历史资格不等于当前可用；只把active模型和当前可见ready档案交给选择流程。
    return { ...policy, qualified_options: policy.qualified_options.filter(option => {
            const model = catalog.find(m => m.id === option.provider_model_id);
            const voice = voices.find(v => v.voice_profile_id === option.voice_profile_id);
            return model?.modelId === option.model && voice?.provider_voice_id === option.voice &&
                checkNarrationExecutionCompatibility({ catalog, projectMode: "narration_first_v1", operation: "project.configuration", model, voice }).compatible;
        }) };
}
async function readPolicyVoices(db: DbClient, ownerId: string, policy: NarrationFirstModelPolicyV1): Promise<VoiceProfile[]> {
    return (await Promise.all(policy.qualified_options.map(o => getVoiceProfileById(db, o.voice_profile_id, { ownerId })))).filter((v): v is VoiceProfile => v !== null);
}
/** 冲突返回前重新读取owner可见档案，复用物化时的当前资格过滤。 */
export async function narrationPolicyErrorForOwner(db: DbClient, ownerId: string, code: NarrationSelectionError["error"], reason: string, policy = NARRATION_FIRST_MODEL_POLICY_V1): Promise<NarrationPolicyError> {
    const voices = await readPolicyVoices(db, ownerId, policy);
    return narrationPolicyError(code, reason, availableNarrationPolicy(policy, [...db.providerModelCatalog.values()], voices));
}
/** 只读：owner 当前可见的合格组合投影（升级预览等只读入口复用同一过滤，不另设真相源）。 */
export async function availableNarrationOptionsForOwner(db: DbClient, ownerId: string, policy = NARRATION_FIRST_MODEL_POLICY_V1) {
    const voices = await readPolicyVoices(db, ownerId, policy);
    return availableNarrationPolicy(policy, [...db.providerModelCatalog.values()], voices);
}
/** 纯物化策略，创建、保存及未来显式升级复用；不修改传入配置或偏好。 */
export function resolveNarrationModelPolicy(input: {
    configuration: GenerationConfigurationV1;
    selection?: unknown;
    catalog: Iterable<ProviderModelCatalogRecord>;
    voices: Iterable<VoiceProfile>;
    policy?: NarrationFirstModelPolicyV1;
}): GenerationConfigurationV1 {
    const policy = input.policy ?? NARRATION_FIRST_MODEL_POLICY_V1;
    const catalog = [...input.catalog];
    const voices = [...input.voices];
    const availablePolicy = availableNarrationPolicy(policy, catalog, voices);
    const deny = (reason: string): never => { throw narrationPolicyError("narration_selection_required", reason, availablePolicy); };
    // DB继承及内部保存调用也必须满足完整配置合同，显式选模不能掩盖坏参数。
    const parsedConfiguration = GenerationConfigurationV1.safeParse(input.configuration);
    if (!parsedConfiguration.success)
        return deny("继承或保存的生成配置无效，请修正配置后重新提交");
    const validatedConfiguration = parsedConfiguration.data;
    const parsed = input.selection === undefined ? undefined : NarrationSelection.safeParse(input.selection);
    if (parsed && !parsed.success)
        return deny("请选择当前合格模型与音色档案");
    const selection = parsed?.success ? parsed.data : undefined;
    if (selection && selection.policy_version !== policy.policy_version)
        throw narrationPolicyError("narration_policy_changed", "口播策略已更新，请按当前选项重新确认", availablePolicy);
    const inherited = validatedConfiguration.capabilities["tts.synthesize"];
    const modelId = selection?.provider_model_id ?? (inherited.mode === "fixed" ? inherited.provider_model_id : policy.default_provider_model_id);
    const voiceId = selection?.voice_profile_id ?? validatedConfiguration.creative.voice_profile_id ??
        (modelId === policy.default_provider_model_id ? policy.default_voice_profile_id : policy.qualified_options.find(o => o.provider_model_id === modelId)?.voice_profile_id);
    const option = policy.qualified_options.find(o => o.provider_model_id === modelId && o.voice_profile_id === voiceId);
    if (!option)
        return deny("继承或显式选择的模型/音色组合未通过口播资格");
    const model = catalog.find(m => m.id === modelId);
    const voice = voices.find(v => v.voice_profile_id === voiceId);
    if (!model || !voice || model.modelId !== option.model || voice.provider_voice_id !== option.voice)
        return deny("合格模型或音色档案缺失或身份已改变");
    const compatibility = checkNarrationExecutionCompatibility({
        catalog, projectMode: "narration_first_v1", operation: "project.configuration", model, voice,
    });
    if (!compatibility.compatible)
        return deny(compatibility.reason);
    const configuration = structuredClone(validatedConfiguration);
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: modelId };
    configuration.creative.voice_profile_id = option.voice_profile_id;
    configuration.narration_policy = {
        policy_version: policy.policy_version,
        selection_reason: selection ? "explicit_selection" : inherited.mode === "auto" ? "recommended_auto" : "qualified_fixed",
        qualification_report: policy.qualification_report,
    };
    return configuration;
}
/** 只读加载owner可见档案；任何拒绝都在项目/配置写入之前。 */
export async function materializeNarrationConfiguration(db: DbClient, ownerId: string, configuration: GenerationConfigurationV1, selection?: unknown, policy = NARRATION_FIRST_MODEL_POLICY_V1): Promise<GenerationConfigurationV1> {
    const voices = await readPolicyVoices(db, ownerId, policy);
    return resolveNarrationModelPolicy({ configuration, selection, catalog: db.providerModelCatalog.values(), voices, policy });
}
