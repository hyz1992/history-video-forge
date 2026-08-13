import { randomUUID } from "node:crypto";

import type {
  AssetPlan,
  AssetPlanningValidationResult,
  CapabilitySlot,
  ExportArtifact,
  GenerationConfigurationV1,
  MediaLibraryItem,
  RenderJobStatus,
  RenderValidationResult,
  VoiceProfile,
} from "../../../shared/src/index.js";
import type { TopicRecommendationFilter } from "../../../shared/src/topic/topic-recommendation-filter.schema.js";

export interface ProjectRecord {
  id: string;
  name: string;
  ownerId: string;
  createdById: string;
  status: string;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  activeStoryboardRecordId: string | null;
  activeAssetPlanRecordId: string | null;
  activeAssetManifestRecordId: string | null;
  activeComposeRecordId: string | null;
  activeRenderJobRecordId: string | null;
  activePublishPackageRecordId: string | null;
  latestTopicRunTraceJson: Record<string, unknown> | null;
  latestScriptRunTraceJson: Record<string, unknown> | null;
  latestStoryboardRunTraceJson: Record<string, unknown> | null;
  latestAssetPlanRunTraceJson: Record<string, unknown> | null;
  latestAssetsRunTraceJson: Record<string, unknown> | null;
  latestComposeRunTraceJson: Record<string, unknown> | null;
  latestRenderRunTraceJson: Record<string, unknown> | null;
  storageDisplayName: string;
  storageShortId: string;
  storageRootDir: string;
  storageRenameLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRegistryRecord {
  id: string;
  canonicalName: string;
  aliases: string[];
  canonicalQuotesJson: string[];
  canonicalQuoteIntentsJson: Array<{ quote: string; intent: string }>;
  sourceType: string;
  isProvisional: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TopicPackageRecord {
  id: string;
  projectId: string;
  eventRegistryEntryId: string | null;
  title: string;
  selectedAngle: string;
  familyLabel: string;
  scopeLabel: string;
  coreConflict: string;
  strongScene: string;
  stakes: string | null;
  packagingSeed: string;
  canonicalQuotesJson: string[];
  canonicalQuoteIntentsJson: Array<{ quote: string; intent: string }>;
  durationBandJson: Record<string, unknown>;
  narrativeTensionMapJson: Record<string, unknown>;
  mustIncludeBeatsJson: unknown[];
  forbiddenExpansionsJson: unknown[];
  riskHintsJson: unknown[];
  sourceAnchorRefsJson: unknown[];
  ambiguityNotesJson: unknown[];
  sourceMode: string;
  sourceRefJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CandidateCacheRecord {
  id: string;
  projectId: string | null;
  eventRegistryEntryId: string | null;
  eventIdentity: string | null;
  fingerprint: string;
  filterFingerprint?: string | null;
  oneLineAngle: string;
  familyLabel: string;
  scopeLabel: string;
  viralRubricJson: Record<string, unknown>;
  estimatedDurationBandJson: unknown;
  strongScene: string;
  coreConflict: string;
  mustCoverPreviewJson: unknown[];
  sourceHint: string;
  recentUsageHint: string;
  whyThisNow: string;
  riskHintsJson: string[];
  createdAt: Date;
}

export interface ScriptRecord {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptText: string;
  openingSpan: string;
  endingSpan: string;
  estimatedDurationSec: number;
  beatTraceJson: unknown[];
  quoteTraceJson: unknown[];
  reviewStatus: string;
  validationResultJson: Record<string, unknown> | null;
  semanticReviewResultJson: Record<string, unknown> | null;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface StoryboardRecord {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  planJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown>;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AssetPlanRecord {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  planJson: AssetPlan;
  validationResultJson: AssetPlanningValidationResult;
  executionStateJson: Record<string, unknown>;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AssetManifestRecord {
  id: string;
  projectId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetPlanRecordId: string;
  manifestJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown>;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ComposeRecord {
  id: string;
  projectId: string;
  assetManifestRecordId: string;
  timelineJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown>;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface RenderJobRecord {
  id: string;
  projectId: string;
  composeRecordId: string;
  assetManifestRecordId: string;
  status: RenderJobStatus;
  profileJson: Record<string, unknown>;
  outputArtifactJson: ExportArtifact | null;
  validationResultJson: RenderValidationResult;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublishPackageRecord {
  id: string;
  projectId: string;
  renderJobRecordId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetManifestRecordId: string;
  packageJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown> | null;
  executionStateJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AssetProviderJobStatus =
  | "prepared"
  | "submitted"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface AssetProviderJobRecord {
  id: string;
  assetManifestRecordId: string;
  assetRunId: string;
  executionId: string;
  taskId: string;
  providerType: string;
  providerName: string;
  providerJobId: string | null;
  status: AssetProviderJobStatus;
  attemptCount: number;
  // S2-2A call-intent 防重字段（外部提交前写库，配合部分唯一索引防重复计费）。
  generationRunId: string | null;
  providerRequestKey: string | null;
  rawRequestJson: Record<string, unknown> | null;
  rawResponseJson: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  submittedAt: Date | null;
  lastPolledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectRecommendationRoundCandidateRecord {
  eventRegistryEntryId: string;
  eventIdentity: string | null;
  title: string | null;
  fingerprint: string;
  filterFingerprint?: string | null;
  createdAt: Date;
}

export interface ProjectRecommendationRoundRecord {
  projectId: string;
  createdAt: Date;
  filterFingerprint?: string | null;
  filterJson?: TopicRecommendationFilter | null;
  candidates: ProjectRecommendationRoundCandidateRecord[];
}

// --- S2-2A 生成配置与费用治理 record 接口 ---------------------------------
// 金额字段统一为 string（十进制微元），与 shared decimalMicrosString 一致。

export interface UserGenerationPreferenceRecord {
  id: string;
  userId: string;
  schemaVersion: string;
  revision: number;
  configurationJson: GenerationConfigurationV1;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectGenerationConfigurationRecord {
  id: string;
  projectId: string;
  schemaVersion: string;
  revision: number;
  sourceUserPreferenceRevision: number | null;
  configurationJson: GenerationConfigurationV1;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderModelCatalogRecord {
  id: string;
  capability: CapabilitySlot;
  providerKey: string;
  modelId: string;
  modelVersion: string | null;
  displayName: string;
  qualityTier: string | null;
  speedTier: string | null;
  parameterCapabilitiesJson: Record<string, unknown>;
  pricingVersion: string;
  pricingJson: Record<string, unknown>;
  status: "active" | "disabled";
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryboardSegmentOverrideRecord {
  id: string;
  projectId: string;
  storyboardRecordId: string;
  segmentId: string;
  strategyOverride: "api_video" | "remotion_motion" | null;
  revision: number;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationCostQuoteRecord {
  id: string;
  projectId: string;
  userId: string | null;
  operation: string;
  configurationHash: string;
  quoteFingerprint: string;
  pricingHash: string;
  pricingVersionSetJson: string[];
  itemsJson: unknown[];
  estimatedCostMicros: string;
  authorizationCostMicros: string;
  containsUnboundedItem: boolean;
  budgetLimitMicros: string | null;
  overBudget: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunConfigurationSnapshotRecord {
  id: string;
  projectId: string;
  userId: string | null;
  stage: string;
  operation: string;
  runId: string | null;
  projectConfigurationRevision: number;
  schemaVersion: string;
  configurationHash: string;
  resolvedConfigurationJson: Record<string, unknown>;
  resolutionTraceJson: unknown[];
  quoteId: string | null;
  quoteFingerprint: string | null;
  estimatedCostMicros: string | null;
  authorizationCostMicros: string | null;
  budgetLimitMicros: string | null;
  budgetOverrideAuthorized: boolean;
  pricingHash: string | null;
  pricingVersionSetJson: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationRunRecord {
  id: string;
  projectId: string;
  userId: string | null;
  operation: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  quoteId: string | null;
  runConfigurationSnapshotId: string;
  dispatchPayloadJson: Record<string, unknown>;
  status: "pending_dispatch" | "running" | "succeeded" | "failed" | "needs_reconciliation";
  dispatchLeaseOwner: string | null;
  dispatchLeaseExpiresAt: Date | null;
  dispatchClaimCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationRunEventRecord {
  id: string;
  generationRunId: string;
  eventType: string;
  segmentId: string | null;
  eventJson: Record<string, unknown>;
  createdAt: Date;
}

export interface UsageCostRecordRecord {
  id: string;
  runConfigurationSnapshotId: string;
  assetProviderJobRecordId: string | null;
  interactionId: string | null;
  capability: string;
  providerKey: string;
  modelId: string;
  providerRequestKey: string;
  attemptIndex: number;
  status: "planned" | "submitted" | "succeeded" | "failed" | "canceled";
  unitType: "token" | "image" | "video_second" | "tts_character" | "request";
  inputUnits: number | null;
  outputUnits: number | null;
  estimatedCostMicros: string;
  actualCostMicros: string | null;
  costBasis: "estimate" | "provider_usage" | "provider_invoice";
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbClient {
  generateId: () => string;
  projects: Map<string, ProjectRecord>;
  events: Map<string, EventRegistryRecord>;
  topicPackages: Map<string, TopicPackageRecord>;
  candidateCache: Map<string, CandidateCacheRecord>;
  topicRunCounts: Map<string, number>;
  scriptRecords: Map<string, ScriptRecord>;
  storyboardRecords: Map<string, StoryboardRecord>;
  assetPlanRecords: Map<string, AssetPlanRecord>;
  assetManifestRecords: Map<string, AssetManifestRecord>;
  composeRecords: Map<string, ComposeRecord>;
  renderJobRecords: Map<string, RenderJobRecord>;
  publishPackageRecords: Map<string, PublishPackageRecord>;
  assetProviderJobRecords: Map<string, AssetProviderJobRecord>;
  recommendationRounds: Map<string, ProjectRecommendationRoundRecord[]>;
  mediaLibraryItems: Map<string, MediaLibraryItem>;
  voiceProfiles: Map<string, VoiceProfile>;
  voiceProfilePersistence: {
    rootDir?: string;
    enabled: boolean;
    loaded: boolean;
  };
  // S2-2A 内存态集合（legacy 测试态与 Prisma 双写过渡；不塞进项目快照 JSON）
  userGenerationPreferences: Map<string, UserGenerationPreferenceRecord>;
  projectGenerationConfigurations: Map<string, ProjectGenerationConfigurationRecord>;
  providerModelCatalog: Map<string, ProviderModelCatalogRecord>;
  storyboardSegmentOverrides: Map<string, StoryboardSegmentOverrideRecord>;
  generationCostQuotes: Map<string, GenerationCostQuoteRecord>;
  runConfigurationSnapshots: Map<string, RunConfigurationSnapshotRecord>;
  generationRuns: Map<string, GenerationRunRecord>;
  generationRunEvents: Map<string, GenerationRunEventRecord[]>;
  usageCostRecords: Map<string, UsageCostRecordRecord>;
  firstAggregateWriter?: {
    ownerId: string;
    createProject(record: ProjectRecord): Promise<void>;
    syncProject(record: ProjectRecord): Promise<void>;
    archiveProject(projectId: string): Promise<void>;
    saveEvent(record: EventRegistryRecord): Promise<void>;
    saveCandidate(record: CandidateCacheRecord): Promise<void>;
    recordRecommendationRound(record: ProjectRecommendationRoundRecord, projectOwnerId: string): Promise<void>;
    activateTopic(project: ProjectRecord, topic: TopicPackageRecord): Promise<void>;
    saveUserGenerationPreference(record: UserGenerationPreferenceRecord): Promise<void>;
    saveProjectGenerationConfiguration(record: ProjectGenerationConfigurationRecord): Promise<void>;
    saveProviderModelCatalogEntry(record: ProviderModelCatalogRecord): Promise<void>;
    createProjectWithGenerationConfiguration(
      project: ProjectRecord,
      configuration: ProjectGenerationConfigurationRecord,
    ): Promise<void>;
  };
  secondAggregateWriter?: {
    saveScript(record: ScriptRecord): Promise<void>;
    saveStoryboard(record: StoryboardRecord): Promise<void>;
    saveAssetPlan(record: AssetPlanRecord): Promise<void>;
    activateScript(project: ProjectRecord, record: ScriptRecord): Promise<void>;
    activateStoryboard(project: ProjectRecord, record: StoryboardRecord): Promise<void>;
    activateAssetPlan(project: ProjectRecord, record: AssetPlanRecord): Promise<void>;
    saveStoryboardSegmentOverride(record: StoryboardSegmentOverrideRecord): Promise<void>;
  };
  thirdAggregateWriter?: {
    saveAssetManifest(record: AssetManifestRecord, projectOwnerId: string): Promise<void>;
    saveCompose(record: ComposeRecord, projectOwnerId: string): Promise<void>;
    saveRender(record: RenderJobRecord, projectOwnerId: string): Promise<void>;
    savePublish(record: PublishPackageRecord, projectOwnerId: string): Promise<void>;
    saveProviderJob(record: AssetProviderJobRecord, projectOwnerId: string): Promise<AssetProviderJobRecord>;
    activateAssetManifest(project: ProjectRecord, record: AssetManifestRecord): Promise<void>;
    activateCompose(project: ProjectRecord, record: ComposeRecord): Promise<void>;
    activateRender(project: ProjectRecord, record: RenderJobRecord): Promise<void>;
    activatePublish(project: ProjectRecord, record: PublishPackageRecord): Promise<void>;
    saveGenerationCostQuote(record: GenerationCostQuoteRecord): Promise<void>;
    appendRunConfigurationSnapshot(record: RunConfigurationSnapshotRecord): Promise<void>;
    saveGenerationRun(record: GenerationRunRecord): Promise<void>;
    appendGenerationRunEvent(record: GenerationRunEventRecord): Promise<void>;
    saveUsageCostRecord(record: UsageCostRecordRecord): Promise<void>;
  };
}

export function createDbClient(): DbClient {
  return {
    generateId: () => randomUUID(),
    projects: new Map<string, ProjectRecord>(),
    events: new Map<string, EventRegistryRecord>(),
    topicPackages: new Map<string, TopicPackageRecord>(),
    candidateCache: new Map<string, CandidateCacheRecord>(),
    topicRunCounts: new Map<string, number>(),
    scriptRecords: new Map<string, ScriptRecord>(),
    storyboardRecords: new Map<string, StoryboardRecord>(),
    assetPlanRecords: new Map<string, AssetPlanRecord>(),
    assetManifestRecords: new Map<string, AssetManifestRecord>(),
    composeRecords: new Map<string, ComposeRecord>(),
    renderJobRecords: new Map<string, RenderJobRecord>(),
    publishPackageRecords: new Map<string, PublishPackageRecord>(),
    assetProviderJobRecords: new Map<string, AssetProviderJobRecord>(),
    recommendationRounds: new Map<string, ProjectRecommendationRoundRecord[]>(),
    mediaLibraryItems: new Map<string, MediaLibraryItem>(),
    voiceProfiles: new Map<string, VoiceProfile>(),
    voiceProfilePersistence: {
      enabled: false,
      loaded: false,
    },
    userGenerationPreferences: new Map<string, UserGenerationPreferenceRecord>(),
    projectGenerationConfigurations: new Map<string, ProjectGenerationConfigurationRecord>(),
    providerModelCatalog: new Map<string, ProviderModelCatalogRecord>(),
    storyboardSegmentOverrides: new Map<string, StoryboardSegmentOverrideRecord>(),
    generationCostQuotes: new Map<string, GenerationCostQuoteRecord>(),
    runConfigurationSnapshots: new Map<string, RunConfigurationSnapshotRecord>(),
    generationRuns: new Map<string, GenerationRunRecord>(),
    generationRunEvents: new Map<string, GenerationRunEventRecord[]>(),
    usageCostRecords: new Map<string, UsageCostRecordRecord>(),
  };
}
