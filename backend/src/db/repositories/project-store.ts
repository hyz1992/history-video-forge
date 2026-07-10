export interface StoredProjectRecord {
  id: string;
  ownerId: string;
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
  name: string;
  storageKey: string;
  storageDisplayName: string;
}

export interface ProjectStore {
  create(input: CreateProjectRecordInput): Promise<StoredProjectRecord>;
  findAccessibleById(projectId: string, ownerId?: string): Promise<StoredProjectRecord | null>;
  listByOwner(ownerId: string): Promise<StoredProjectRecord[]>;
  updateStatus(projectId: string, status: string): Promise<StoredProjectRecord>;
}
