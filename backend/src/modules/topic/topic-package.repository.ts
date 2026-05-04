import type { DbClient, TopicPackageRecord } from "../../db/client";

export interface SaveTopicPackageInput {
  projectId: string;
  eventRegistryEntryId?: string | null;
  title: string;
  selectedAngle: string;
  familyLabel: string;
  scopeLabel: string;
  coreConflict: string;
  strongScene: string;
  stakes?: string | null;
  packagingSeed: string;
  canonicalQuotesJson?: string[];
  durationBandJson: Record<string, unknown>;
  narrativeTensionMapJson: Record<string, unknown>;
  mustIncludeBeatsJson?: unknown[];
  forbiddenExpansionsJson?: unknown[];
  riskHintsJson?: unknown[];
  sourceAnchorRefsJson?: unknown[];
  ambiguityNotesJson?: unknown[];
}

export async function saveTopicPackage(
  db: DbClient,
  input: SaveTopicPackageInput,
): Promise<TopicPackageRecord> {
  const record: TopicPackageRecord = {
    id: db.generateId(),
    projectId: input.projectId,
    eventRegistryEntryId: input.eventRegistryEntryId ?? null,
    title: input.title,
    selectedAngle: input.selectedAngle,
    familyLabel: input.familyLabel,
    scopeLabel: input.scopeLabel,
    coreConflict: input.coreConflict,
    strongScene: input.strongScene,
    stakes: input.stakes ?? null,
    packagingSeed: input.packagingSeed,
    canonicalQuotesJson: input.canonicalQuotesJson ?? [],
    durationBandJson: input.durationBandJson,
    narrativeTensionMapJson: input.narrativeTensionMapJson,
    mustIncludeBeatsJson: input.mustIncludeBeatsJson ?? [],
    forbiddenExpansionsJson: input.forbiddenExpansionsJson ?? [],
    riskHintsJson: input.riskHintsJson ?? [],
    sourceAnchorRefsJson: input.sourceAnchorRefsJson ?? [],
    ambiguityNotesJson: input.ambiguityNotesJson ?? [],
    createdAt: new Date(),
  };

  db.topicPackages.set(record.id, record);

  return record;
}
