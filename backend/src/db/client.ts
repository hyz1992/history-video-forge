import { randomUUID } from "node:crypto";

import type {
  AssetPlan,
  AssetPlanningValidationResult,
  ExportArtifact,
  MediaLibraryItem,
  RenderJobStatus,
  RenderValidationResult,
  VoiceProfile,
} from "../../../shared/src/index.js";

export interface ProjectRecord {
  id: string;
  name: string;
  status: string;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  activeStoryboardRecordId: string | null;
  activeAssetPlanRecordId: string | null;
  activeAssetManifestRecordId: string | null;
  activeComposeRecordId: string | null;
  activeRenderJobRecordId: string | null;
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
  createdAt: Date;
}

export interface CandidateCacheRecord {
  id: string;
  projectId: string | null;
  eventRegistryEntryId: string | null;
  eventIdentity: string | null;
  fingerprint: string;
  oneLineAngle: string;
  familyLabel: string;
  scopeLabel: string;
  viralRubricJson: Record<string, unknown>;
  estimatedDurationBandJson: unknown;
  strongScene: string;
  coreConflict: string;
  mustCoverPreviewJson: unknown[];
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
  assetProviderJobRecords: Map<string, AssetProviderJobRecord>;
  mediaLibraryItems: Map<string, MediaLibraryItem>;
  voiceProfiles: Map<string, VoiceProfile>;
  voiceProfilePersistence: {
    rootDir?: string;
    enabled: boolean;
    loaded: boolean;
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
    assetProviderJobRecords: new Map<string, AssetProviderJobRecord>(),
    mediaLibraryItems: new Map<string, MediaLibraryItem>(),
    voiceProfiles: new Map<string, VoiceProfile>(),
    voiceProfilePersistence: {
      enabled: false,
      loaded: false,
    },
  };
}
