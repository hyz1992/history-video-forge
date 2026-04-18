import type { DbClient, TopicPackageRecord } from "../../db/client";

export interface SaveTopicPackageInput {
  projectId: string;
  eventRegistryEntryId?: string | null;
  title: string;
  selectedAngle: string;
  coreConflict: string;
  stakes?: string | null;
  narrativeTensionMapJson: Record<string, unknown>;
  mustIncludeBeatsJson?: unknown[];
  forbiddenExpansionsJson?: unknown[];
  riskHintsJson?: unknown[];
  sourceAnchorRefsJson?: unknown[];
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
    coreConflict: input.coreConflict,
    stakes: input.stakes ?? null,
    narrativeTensionMapJson: input.narrativeTensionMapJson,
    mustIncludeBeatsJson: input.mustIncludeBeatsJson ?? [],
    forbiddenExpansionsJson: input.forbiddenExpansionsJson ?? [],
    riskHintsJson: input.riskHintsJson ?? [],
    sourceAnchorRefsJson: input.sourceAnchorRefsJson ?? [],
    createdAt: new Date(),
  };

  db.topicPackages.set(record.id, record);

  return record;
}
