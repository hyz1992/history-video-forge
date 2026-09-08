import type { AssetPlanRecord, ProjectRecord, ScriptRecord, StoryboardRecord, StoryboardSegmentOverrideRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";
import { invalidatePrismaNarration, NarrationSourceError } from "../../modules/narration/narration-invalidation.js";

const scriptData = (record: ScriptRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptText: record.scriptText,
  openingSpan: record.openingSpan, endingSpan: record.endingSpan, estimatedDurationSec: record.estimatedDurationSec,
  beatTraceJson: record.beatTraceJson as never, quoteTraceJson: record.quoteTraceJson as never,
  reviewStatus: record.reviewStatus, validationResultJson: record.validationResultJson as never,
  semanticReviewResultJson: record.semanticReviewResultJson as never, executionStateJson: record.executionStateJson as never,
  graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});
const storyboardData = (record: StoryboardRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId,
  planJson: record.planJson as never, validationResultJson: record.validationResultJson as never,
  executionStateJson: record.executionStateJson as never, graphTraceSummaryJson: record.graphTraceSummaryJson as never,
  runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});
const assetPlanData = (record: AssetPlanRecord) => ({
  projectId: record.projectId, topicPackageId: record.topicPackageId, scriptRecordId: record.scriptRecordId,
  storyboardRecordId: record.storyboardRecordId, planJson: record.planJson as never,
  validationResultJson: record.validationResultJson as never, executionStateJson: record.executionStateJson as never,
  graphTraceSummaryJson: record.graphTraceSummaryJson as never, runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as never,
});

export class PrismaSecondAggregateWriter {
  constructor(private readonly client: AppPrismaClient, private readonly ownerId: string) {}

  async saveScript(record: ScriptRecord): Promise<void> {
    const data = scriptData(record);
    await this.client.$transaction(async tx => {
      const project = await tx.project.findUnique({ where: { id: record.projectId } });
      const previous = await tx.scriptRecord.findUnique({ where: { id: record.id } });
      if (project?.activeScriptRecordId === record.id && previous && previous.scriptText !== record.scriptText) {
        await invalidatePrismaNarration(tx, project);
      }
      await tx.scriptRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
    });
  }
  async saveStoryboard(record: StoryboardRecord): Promise<void> {
    const data = storyboardData(record);
    await this.client.storyboardRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }
  async saveAssetPlan(record: AssetPlanRecord): Promise<void> {
    const data = assetPlanData(record);
    await this.client.assetPlanRecord.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }

  async activateScript(project: ProjectRecord, record: ScriptRecord, expectedActiveScriptRecordId?: string | null): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId, archivedAt: null } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if (topic?.projectId !== project.id || stored?.projectId !== project.id) throw new Error("script_activation_project_mismatch");
      if (scoped.narrationTimingMode === "narration_first_v1") {
        if (scoped.activeTopicPackageId !== record.topicPackageId || expectedActiveScriptRecordId === undefined || scoped.activeScriptRecordId !== expectedActiveScriptRecordId) throw new NarrationSourceError("narration_stale");
        if (scoped.activeScriptRecordId !== record.id) await invalidatePrismaNarration(tx, scoped);
      }
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeScriptRecordId: record.id, activeStoryboardRecordId: null, activeAssetPlanRecordId: null,
        activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null,
        latestScriptRunTraceJson: project.latestScriptRunTraceJson as never, latestStoryboardRunTraceJson: project.latestStoryboardRunTraceJson as never,
        latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never, latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never,
        latestComposeRunTraceJson: project.latestComposeRunTraceJson as never, latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }

  async activateStoryboard(project: ProjectRecord, record: StoryboardRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, script, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { id: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if ([topic, script, stored].some((item) => item?.projectId !== project.id)) throw new Error("storyboard_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeStoryboardRecordId: record.id, activeAssetPlanRecordId: null,
        activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null,
        latestStoryboardRunTraceJson: project.latestStoryboardRunTraceJson as never, latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never,
        latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never, latestComposeRunTraceJson: project.latestComposeRunTraceJson as never,
        latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }

  async activateAssetPlan(project: ProjectRecord, record: AssetPlanRecord): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const [scoped, topic, script, storyboard, stored] = await Promise.all([
        tx.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { id: true } }),
        tx.topicPackage.findUnique({ where: { id: record.topicPackageId }, select: { projectId: true } }),
        tx.scriptRecord.findUnique({ where: { id: record.scriptRecordId }, select: { projectId: true } }),
        tx.storyboardRecord.findUnique({ where: { id: record.storyboardRecordId }, select: { projectId: true } }),
        tx.assetPlanRecord.findUnique({ where: { id: record.id }, select: { projectId: true } }),
      ]);
      if (!scoped) throw new Error("project_scope_denied");
      if ([topic, script, storyboard, stored].some((item) => item?.projectId !== project.id)) throw new Error("asset_plan_activation_project_mismatch");
      await tx.project.update({ where: { id: project.id }, data: {
        status: project.status, activeAssetPlanRecordId: record.id, activeAssetManifestRecordId: null,
        activeComposeRecordId: null, activeRenderJobRecordId: null,
        latestAssetPlanRunTraceJson: project.latestAssetPlanRunTraceJson as never, latestAssetsRunTraceJson: project.latestAssetsRunTraceJson as never,
        latestComposeRunTraceJson: project.latestComposeRunTraceJson as never, latestRenderRunTraceJson: project.latestRenderRunTraceJson as never,
      } });
    });
  }

  // --- S2-2A 分镜级视觉策略覆盖 ---

  /**
   * 保存分镜覆盖。唯一约束为 (storyboardRecordId, segmentId)；
   * projectId 只用于 owner scope/index，不另造第二套唯一语义。
   */
  async saveStoryboardSegmentOverride(record: StoryboardSegmentOverrideRecord): Promise<void> {
    const data = {
      projectId: record.projectId,
      storyboardRecordId: record.storyboardRecordId,
      segmentId: record.segmentId,
      strategyOverride: record.strategyOverride,
      revision: record.revision,
      updatedByUserId: record.updatedByUserId,
      updatedAt: record.updatedAt,
    };
    await this.client.storyboardSegmentOverride.upsert({
      where: { storyboardRecordId_segmentId: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId } },
      create: { id: record.id, ...data, createdAt: record.createdAt },
      update: data,
    });
  }

  /**
   * 分镜覆盖 CAS（P1 整改）：expectedRevision=0 → 事务内 create（唯一冲突→返回现有记录）；
   * expectedRevision>0 → 条件 updateMany WHERE revision=expectedRevision。
   * 冲突归类：
   * - P2002（唯一约束冲突）→ conflict + existingRecord
   * - updateMany count=0 → conflict + existingRecord
   * - P1008 / P2034（SQLite 双连接并发锁超时，事务已回滚）→ 事务外重读，记录存在即 conflict；
   *   记录不存在且为首建则重试一次。其他事务异常继续抛出。
   */
  async casUpsertStoryboardSegmentOverride(
    record: StoryboardSegmentOverrideRecord,
    expectedRevision: number,
  ): Promise<{ success: true } | { success: false; conflict: true; existingRecord: StoryboardSegmentOverrideRecord }> {
    try {
      return await this.client.$transaction(async (tx) => {
        if (expectedRevision === 0) {
          try {
            await tx.storyboardSegmentOverride.create({
              data: {
                id: record.id, projectId: record.projectId, storyboardRecordId: record.storyboardRecordId,
                segmentId: record.segmentId, strategyOverride: record.strategyOverride,
                revision: record.revision, updatedByUserId: record.updatedByUserId,
                createdAt: record.createdAt, updatedAt: record.updatedAt,
              },
            });
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              const existing = await tx.storyboardSegmentOverride.findUnique({
                where: { storyboardRecordId_segmentId: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId } },
              });
              if (!existing) throw error;
              return { success: false, conflict: true, existingRecord: mapOverrideRow(existing) };
            }
            throw error;
          }
        } else {
          const result = await tx.storyboardSegmentOverride.updateMany({
            where: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId, revision: expectedRevision },
            data: {
              strategyOverride: record.strategyOverride,
              revision: record.revision,
              updatedByUserId: record.updatedByUserId,
              updatedAt: record.updatedAt,
            },
          });
          if (result.count !== 1) {
            const existing = await tx.storyboardSegmentOverride.findUnique({
              where: { storyboardRecordId_segmentId: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId } },
            });
            return { success: false, conflict: true, existingRecord: existing ? mapOverrideRow(existing) : record };
          }
        }
        return { success: true };
      });
    } catch (error) {
      // P1：SQLite 双连接并发时 loser 可能因锁等待超时抛 P1008（事务已回滚）。
      // 事务外受控重读：记录存在即确认被竞争写入 → conflict；
      // 记录不存在且为 expectedRevision=0 首建 → 重试一次单语句 create（原子，无事务锁竞争）。
      if (isTransactionBusyError(error)) {
        const existing = await this.client.storyboardSegmentOverride.findUnique({
          where: { storyboardRecordId_segmentId: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId } },
        });
        if (existing) {
          return { success: false, conflict: true, existingRecord: mapOverrideRow(existing) };
        }
        if (expectedRevision === 0) {
          try {
            await this.client.storyboardSegmentOverride.create({
              data: {
                id: record.id, projectId: record.projectId, storyboardRecordId: record.storyboardRecordId,
                segmentId: record.segmentId, strategyOverride: record.strategyOverride,
                revision: record.revision, updatedByUserId: record.updatedByUserId,
                createdAt: record.createdAt, updatedAt: record.updatedAt,
              },
            });
            return { success: true };
          } catch (retryError) {
            if (isUniqueConstraintError(retryError) || isTransactionBusyError(retryError)) {
              const after = await this.client.storyboardSegmentOverride.findUnique({
                where: { storyboardRecordId_segmentId: { storyboardRecordId: record.storyboardRecordId, segmentId: record.segmentId } },
              });
              if (after) return { success: false, conflict: true, existingRecord: mapOverrideRow(after) };
            }
            throw retryError;
          }
        }
        // expectedRevision>0 且记录不存在：并发窗口内被删除或尚未创建，按 conflict 处理
        return { success: false, conflict: true, existingRecord: record };
      }
      throw error;
    }
  }
}

/** Prisma 唯一约束冲突错误码（P2002）。其他错误不得折叠为 conflict。 */
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

/** SQLite 双连接并发锁等待超时（P1008）或事务冲突（P2034）。 */
function isTransactionBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  return code === "P1008" || code === "P2034";
}

function mapOverrideRow(row: {
  id: string; projectId: string; storyboardRecordId: string; segmentId: string;
  strategyOverride: string | null; revision: number; updatedByUserId: string | null;
  createdAt: Date; updatedAt: Date;
}): StoryboardSegmentOverrideRecord {
  return {
    id: row.id, projectId: row.projectId, storyboardRecordId: row.storyboardRecordId,
    segmentId: row.segmentId,
    strategyOverride: row.strategyOverride as StoryboardSegmentOverrideRecord["strategyOverride"],
    revision: row.revision, updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
