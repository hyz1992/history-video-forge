export interface StoredProjectRecord {
  id: string;
  ownerId: string;
  createdById: string;
  name: string;
  status: string;
  storageKey: string;
  storageDisplayName: string;
  storageRenameLocked: boolean;
  archivedAt: Date | null;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  activeStoryboardRecordId: string | null;
  activeAssetPlanRecordId: string | null;
  activeAssetManifestRecordId: string | null;
  activeComposeRecordId: string | null;
  activeRenderJobRecordId: string | null;
  activePublishPackageRecordId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectRecordInput {
  ownerId: string;
  createdById: string;
  name: string;
  storageKey: string;
  storageDisplayName: string;
}

export interface ActiveProjectRecordPatch {
  activeTopicPackageId?: string | null;
  activeScriptRecordId?: string | null;
  activeStoryboardRecordId?: string | null;
  activeAssetPlanRecordId?: string | null;
  activeAssetManifestRecordId?: string | null;
  activeComposeRecordId?: string | null;
  activeRenderJobRecordId?: string | null;
  activePublishPackageRecordId?: string | null;
}

export interface ProjectStore {
  create(input: CreateProjectRecordInput): Promise<StoredProjectRecord>;
  findByIdForOwner(projectId: string, ownerId: string): Promise<StoredProjectRecord | null>;
  findByIdForSystem(projectId: string): Promise<StoredProjectRecord | null>;
  listByOwner(ownerId: string): Promise<StoredProjectRecord[]>;
  updateStatusForOwner(projectId: string, ownerId: string, status: string): Promise<StoredProjectRecord>;
  archiveForOwner(projectId: string, ownerId: string): Promise<StoredProjectRecord>;
  updateActiveRecordsForOwner(projectId: string, ownerId: string, patch: ActiveProjectRecordPatch): Promise<StoredProjectRecord>;
}
