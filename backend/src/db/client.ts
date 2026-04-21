import { randomUUID } from "node:crypto";

export interface ProjectRecord {
  id: string;
  name: string;
  status: string;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRegistryRecord {
  id: string;
  canonicalName: string;
  aliases: string[];
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
  durationBandJson: Record<string, unknown>;
  narrativeTensionMapJson: Record<string, unknown>;
  mustIncludeBeatsJson: unknown[];
  forbiddenExpansionsJson: unknown[];
  riskHintsJson: unknown[];
  sourceAnchorRefsJson: unknown[];
  createdAt: Date;
}

export interface CandidateCacheRecord {
  id: string;
  projectId: string | null;
  eventRegistryEntryId: string | null;
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

export interface DbClient {
  generateId: () => string;
  projects: Map<string, ProjectRecord>;
  events: Map<string, EventRegistryRecord>;
  topicPackages: Map<string, TopicPackageRecord>;
  candidateCache: Map<string, CandidateCacheRecord>;
  topicRunCounts: Map<string, number>;
  scriptRecords: Map<string, ScriptRecord>;
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
  };
}
