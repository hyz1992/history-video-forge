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
  BudgetConfiguration,
  CAPABILITY_SLOTS,
  CapabilitySelectionMap,
  CreativePreferences,
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
  ConfigurationInvalidationPreview,
  GenerationCapabilitiesResponse,
  PublicCapabilityEntrySchema,
  ProjectGenerationConfigurationResponse,
  UserGenerationPreferenceResponse,
  RunConfigurationSnapshotV1,
  SegmentVisualStrategyOverride,
  VideoGenerationStrategy,
} from "./generation/generation-configuration.schema";
export type {
  CapabilitySlot,
  ResolvedCapabilityMap,
  ResolvedGenerationConfigurationV1,
  ResolvedProviderModel,
  ResolvedSegmentVisualRoute,
  S2_2A_ConfigPatchRequest as S2_2A_ConfigPatchRequestType,
} from "./generation/generation-configuration.schema";
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
