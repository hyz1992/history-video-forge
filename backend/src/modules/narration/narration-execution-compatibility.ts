import type { UserRole } from "../../auth/auth-context.js";
import { AuthorizationError } from "../../auth/authorization.js";
import {
  QualifiedNarrationSettings,
  NarrationTimingMode,
  type VoiceProfile,
} from "../../../../shared/src/index.js";
import type { DbClient, ProviderModelCatalogRecord } from "../../db/client.js";

export type NarrationCompatibilityOperation =
  | "project.configuration"
  | "assets.generate"
  | "voice.preview"
  | "script.narration.generate";

export interface NarrationCompatibilityInput {
  catalog: Iterable<ProviderModelCatalogRecord>;
  projectMode?: NarrationTimingMode;
  operation: NarrationCompatibilityOperation;
  model?: ProviderModelCatalogRecord | null;
  providerKey?: string;
  modelId?: string;
  voice?: Pick<VoiceProfile,
    "target_model" | "provider_name" | "provider_voice_id" | "provider_status"
  > | null;
  actualVoiceTarget?: string;
  /** 当次即将发送的供应商音色ID；可与旧档案或无db分支的ID不同。 */
  actualProviderVoiceId?: string;
  deploymentScope?: string;
  settings?: unknown;
  /** 目录展示尚未选择音色；执行与配置保存不得使用此选项。 */
  candidateOnly?: boolean;
}

export type NarrationCompatibilityDecision =
  | { compatible: true }
  | { compatible: false; code: "narration_execution_incompatible"; reason: string };

function metadata(entry: ProviderModelCatalogRecord): Record<string, unknown> {
  const value: unknown = entry.parameterCapabilitiesJson;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** 未标记历史条目保持旧语义；损坏的新增声明不能被当作未标记。 */
export function isNarrationOnlyCatalogEntry(entry: ProviderModelCatalogRecord): boolean {
  const meta = metadata(entry);
  return entry.capability === "tts.synthesize" && (
    (Object.hasOwn(meta, "narration_only") && meta.narration_only !== false) ||
    (Object.hasOwn(meta, "execution_protocol") && meta.execution_protocol !== "dashscope_http")
  );
}

function wsTarget(
  catalog: ProviderModelCatalogRecord[],
  provider: string | undefined,
  model: string | undefined,
): boolean {
  if (!model) return false;
  // 已实测 WS 模型不能因目录被删除或 HTTP adapter 无 db 而退回 HTTP。
  if (QualifiedNarrationSettings.shape.model.safeParse(model).success) return true;
  return catalog.some(entry =>
    entry.modelId === model &&
    (!provider || entry.providerKey === provider) &&
    isNarrationOnlyCatalogEntry(entry),
  );
}

/** 候选、保存、override 与派发共用的纯检查；不解析 auto、不替换音色或模型。 */
export function checkNarrationExecutionCompatibility(
  input: NarrationCompatibilityInput,
): NarrationCompatibilityDecision {
  const deny = (reason: string): NarrationCompatibilityDecision => ({
    compatible: false,
    code: "narration_execution_incompatible",
    reason,
  });
  const catalog = [...input.catalog];
  const narration = input.operation === "script.narration.generate" ||
    (input.operation === "project.configuration" && input.projectMode === "narration_first_v1");
  if (!narration) {
    if (
      (input.model && isNarrationOnlyCatalogEntry(input.model)) ||
      wsTarget(catalog, input.providerKey ?? input.model?.providerKey, input.modelId ?? input.model?.modelId) ||
      wsTarget(catalog, input.voice?.provider_name, input.voice?.target_model) ||
      wsTarget(catalog, input.voice?.provider_name, input.actualVoiceTarget) ||
      QualifiedNarrationSettings.shape.voice.safeParse(input.voice?.provider_voice_id).success ||
      QualifiedNarrationSettings.shape.voice.safeParse(input.actualProviderVoiceId).success
    ) {
      return deny("旧资产与试听入口不支持口播专用 WS 模型或音色");
    }
    return { compatible: true };
  }
  if (input.projectMode !== "narration_first_v1") {
    return deny("当前项目未启用口播前置模式");
  }
  const model = input.model;
  if (
    !model || model.capability !== "tts.synthesize" || model.status !== "active" ||
    model.providerKey !== "dashscope" ||
    metadata(model).execution_protocol !== "dashscope_ws" || metadata(model).narration_only !== true ||
    !QualifiedNarrationSettings.shape.model.safeParse(model.modelId).success ||
    !QualifiedNarrationSettings.shape.region.safeParse(metadata(model).deployment_scope).success
  ) {
    return deny("口播模型目录协议、范围或资格不可用");
  }
  if (input.deploymentScope !== undefined && input.deploymentScope !== metadata(model).deployment_scope) {
    return deny("口播执行区域与合格目录不符");
  }
  if (input.modelId !== undefined && input.modelId !== model.modelId) {
    return deny("口播实际模型与目录不符");
  }
  if (input.providerKey !== undefined && input.providerKey !== model.providerKey) {
    return deny("口播实际供应商与目录不符");
  }
  if (input.candidateOnly && input.operation === "project.configuration") return { compatible: true };
  const voice = input.voice;
  if (
    !voice || voice.provider_status !== "ready" || voice.provider_name !== model.providerKey ||
    voice.target_model !== model.modelId ||
    !QualifiedNarrationSettings.shape.voice.safeParse(voice.provider_voice_id).success ||
    (input.actualVoiceTarget !== undefined && input.actualVoiceTarget !== model.modelId) ||
    (input.actualProviderVoiceId !== undefined && input.actualProviderVoiceId !== voice.provider_voice_id)
  ) {
    return deny("口播音色与合格模型不符");
  }
  if (input.operation === "script.narration.generate" && !QualifiedNarrationSettings.safeParse(input.settings).success) {
    return deny("口播执行参数未通过完整资格校验");
  }
  return { compatible: true };
}

export function assertNarrationExecutionCompatibility(input: NarrationCompatibilityInput): void {
  const decision = checkNarrationExecutionCompatibility(input);
  if (!decision.compatible) throw new Error(decision.code);
}

/** 模式和音色可见域均来自同一次权威项目读取。角色只能由可信auth调用者传入。 */
export async function readProjectNarrationContext(
  db: DbClient,
  projectId: string,
  actorUserId: string,
  actorRole: UserRole = "USER",
): Promise<{ mode: NarrationTimingMode; ownerId: string }> {
  const client = db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
  const project = client
    ? await client.project.findFirst({ where: { id: projectId, archivedAt: null } })
    : db.projects.get(projectId);
  // 对齐 authorization.requireOwner：ADMIN可管理其他owner，USER只能管理本人项目。
  if (!project || project.id !== projectId ||
    ("archivedAt" in project && project.archivedAt !== null) ||
    (actorRole !== "ADMIN" && project.ownerId !== actorUserId)) {
    throw new AuthorizationError(404, "project_not_found", "project_scope_denied");
  }
  return {
    mode: NarrationTimingMode.parse(project.narrationTimingMode ?? "legacy_estimated"),
    ownerId: project.ownerId,
  };
}

/** 兼容内部owner调用；未显式传入可信角色时始终按USER检查。 */
export async function readProjectNarrationMode(
  db: DbClient,
  projectId: string,
  actorUserId: string,
  actorRole: UserRole = "USER",
): Promise<NarrationTimingMode> {
  return (await readProjectNarrationContext(db, projectId, actorUserId, actorRole)).mode;
}
