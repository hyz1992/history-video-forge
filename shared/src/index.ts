export {
  TopicCandidateCard,
  ViralRubric,
  ViralRubricLevel,
} from "./topic/topic-candidate-card.schema";
export {
  CanonicalQuoteIntent,
  NarrativeTensionMap,
  TopicPackage,
} from "./topic/topic-package.schema";
export {
  RevealPosition,
  TopicDeliveryPack,
} from "./topic/topic-delivery-pack.schema";
export {
  CustomRefinedEvent,
} from "./topic/topic-custom-refine-output.schema";
export {
  TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH,
  TOPIC_RECOMMENDATION_PERIOD_GROUPS,
  TopicRecommendationCentralActorType,
  TopicRecommendationEventDomain,
  TopicRecommendationFilterInputSchema,
  TopicRecommendationFilterSchema,
  TopicRecommendationPeriodId,
  TopicRecommendationStorytellingLens,
  expandTopicRecommendationPeriodRange,
  normalizeTopicRecommendationFilter,
} from "./topic/topic-recommendation-filter.schema";
export { ScriptInputBundle } from "./script/script-input-bundle.schema";
export { ScriptDraftPackage } from "./script/script-draft-package.schema";
export {
  ScriptLocalValidationResult,
  ScriptSemanticReviewResult,
  ScriptValidationResult,
} from "./script/script-validation.schema";
export {
  StoryboardPlan,
  StoryboardSegment,
} from "./storyboard/storyboard-plan.schema";
// generation-configuration.schema：Zod 运行时值与同名类型一起导出。
// CapabilitySlot 是唯一的纯类型（无同名 Zod const），单独用 export type，
// 否则 tsx/ESM 运行时会把它当成值导入并报 SyntaxError（见 P1-1 整改）。
export {
  ApiVideoQuality,
  ApiVideoSuitability,
  AppliedConstraint,
  assertS22AScopeConstraints,
  assertS22BScopeConstraints,
  BudgetConfiguration,
  CAPABILITY_SLOTS,
  CapabilitySelectionMap,
  CreativePreferences,
  CreativeRunOverrideSchema,
  DEFAULT_GENERATION_CONFIGURATION,
  DRIFT_HASH_ALGORITHM,
  DriftHashSchema,
  GenerationConfigurationV1,
  KNOWN_CRYPTO_HASH_PREFIXES,
  KNOWN_DRIFT_HASH_PREFIXES,
  ModelSelection,
  ResolutionTraceEntry,
  ResolvedCapabilityMapSchema,
  ResolvedGenerationConfigurationV1Schema,
  ResolvedProviderModelSchema,
  ResolvedSegmentVisualRouteSchema,
  ResolvedVisualRoute,
  S2_2A_ConfigPatchRequest,
  S2_2A_PATCH_ALLOWED_FIELDS,
  S2_2A_ProjectConfigPatchRequest,
  S2_2B_ConfigPatchRequest,
  S2_2B_ProjectConfigPatchRequest,
  DEFAULT_RESOLVED_CREATIVE,
  ResolvedArtStyleSchema,
  ResolvedCreativeV1Schema,
  ResolvedCreativeVoiceSchema,
  ResolvedSubtitleSchema,
  ConfigurationInvalidationPreview,
  CreativePresetsResponse,
  GenerationCapabilitiesResponse,
  PublicCreativePresetSchema,
  PublicCapabilityEntrySchema,
  ProjectGenerationConfigurationResponse,
  UserGenerationPreferenceResponse,
  RunConfigurationSnapshotV1,
  SegmentVisualStrategyOverride,
  VideoGenerationStrategy,
} from "./generation/generation-configuration.schema";
export type {
  CapabilitySlot,
  CreativeRunOverride,
  ResolvedArtStyle,
  ResolvedCapabilityMap,
  ResolvedCreativeV1,
  ResolvedCreativeVoice,
  ResolvedGenerationConfigurationV1,
  ResolvedProviderModel,
  ResolvedSegmentVisualRoute,
  ResolvedSubtitle,
  S2_2A_ConfigPatchRequest as S2_2A_ConfigPatchRequestType,
  S2_2B_ConfigPatchRequest as S2_2B_ConfigPatchRequestType,
  S2_2B_ProjectConfigPatchRequest as S2_2B_ProjectConfigPatchRequestType,
} from "./generation/generation-configuration.schema";
// creative：S2-2B 版本化画风/字幕 preset 合同、注册表与字幕覆盖解析
export {
  ArtStylePreset,
  ArtStyleResolvedParams,
  CreativePresetRegistrySnapshot,
  SUBTITLE_OVERRIDABLE_FIELDS,
  SUBTITLE_SHADOW_VALUES,
  SubtitleOverrideField,
  SubtitlePresetResolvedParams,
  SubtitleShadowPreset,
  SubtitleStyleOverrideSet,
  SubtitleStylePreset,
} from "./creative/creative-preset.schema";
export { ART_STYLE_PRESET_REGISTRY_V1 } from "./creative/art-style-presets";
export { SUBTITLE_STYLE_PRESET_REGISTRY_V1 } from "./creative/subtitle-style-presets";
export { CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1 } from "./creative/creative-preset-registry";
export { applySubtitleStyleOverrides } from "./creative/subtitle-style-resolver";
// generation-configuration-resolver：运行时函数 + 纯类型（接口/type alias）
export {
  canonicalStringify,
  deterministicHash,
  resolveGenerationConfiguration,
} from "./generation/generation-configuration-resolver";
export type {
  GenerationOperation,
  GenerationResolverError,
  GenerationResolverErrorCode,
  ProviderModelCatalogEntry,
  ResolveGenerationConfigurationInput,
  ResolveGenerationConfigurationResult,
  SegmentInput,
  SystemGenerationConstraints,
} from "./generation/generation-configuration-resolver";
// generation-cost-api.schema：S2-2A 任务 8 报价/成本/运行配置 API 合同
export {
  CnyDecimalString,
  GENERATION_SUBMIT_ERROR_CODES,
  GenerationQuoteItemSchema,
  GenerationQuoteProviderTypesSchema,
  GenerationQuoteRequestSchema,
  GenerationQuoteResponseSchema,
  GenerationQuoteRunOverridesSchema,
  GenerationQuoteSelectionSchema,
  GenerationRunConfigurationResponseSchema,
  ProjectCostRecordSchema,
  ProjectCostRecordsResponseSchema,
  ProjectCostSummarySchema,
} from "./generation/generation-cost-api.schema";
export type {
  GenerationQuoteItem,
  GenerationQuoteProviderTypes,
  GenerationQuoteRequest,
  GenerationQuoteResponse,
  GenerationQuoteRunOverrides,
  GenerationQuoteSelection,
  GenerationRunConfigurationResponse,
  GenerationSubmitErrorCode,
  ProjectCostRecord,
  ProjectCostRecordsResponse,
  ProjectCostSummary,
} from "./generation/generation-cost-api.schema";
export { StoryboardValidationResult } from "./storyboard/storyboard-validation.schema";
export {
  AssetPlan,
  AssetTask,
  ProjectArtBible,
} from "./asset-planning/asset-plan.schema";
export { AssetPlanningValidationResult } from "./asset-planning/asset-planning-validation.schema";
export {
  AssetManifest,
  AssetArtifact,
  AssetAudioSummary,
  AssetExecutionOptions,
  AssetProviderType,
  AssetTaskExecution,
  BgmPlacement,
  DEFAULT_SUBTITLE_STYLE,
  SegmentAssetRoute,
  SubtitleStyle,
  TtsChunkRoute,
} from "./assets/asset-manifest.schema";
export { AssetsValidationResult } from "./assets/assets-validation.schema";
export {
  MediaLibraryItem,
  MediaLibraryLicense,
} from "./assets/media-library.schema";
export {
  VoiceIntent,
  VoiceMatchResult,
  VoiceProfile,
  VoiceProfileKind,
  VoiceProviderStatus,
} from "./voice/voice-profile.schema";
export {
  ComposeClip,
  ComposeClipKind,
  ComposeReadiness,
  ComposeTimeline,
  ComposeTimelineSegment,
  ComposeTrack,
  ComposeTrackType,
} from "./compose/compose-timeline.schema";
export { ComposeValidationResult } from "./compose/compose-validation.schema";
export {
  ExportArtifact,
  RenderJobStatus,
} from "./render/render-job.schema";
export { RenderValidationResult } from "./render/render-validation.schema";
export {
  CoverOrigin,
  PlatformProfile,
  PublishPackage,
  PublishReadiness,
  TitleCandidate,
  TitleStyle,
} from "./publish/publish-package.schema";
