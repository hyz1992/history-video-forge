import {
  type ApiVideoSuitability,
  type AppliedConstraint,
  type CapabilitySlot,
  type GenerationConfigurationV1,
  type ResolutionTraceEntry,
  type ResolvedVisualRoute,
  type SegmentVisualStrategyOverride,
  GenerationConfigurationV1 as GenerationConfigurationV1Schema,
  SegmentVisualStrategyOverride as SegmentVisualStrategyOverrideSchema,
} from "./generation-configuration.schema.js";

/**
 * S2-2A 确定性纯函数配置解析器。
 *
 * 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md
 * （第 5 节）。
 *
 * 约束：
 * - 解析器是纯函数：相同输入产生相同 canonical JSON 与 hash。
 * - 解析器只接受 6 类输入（系统约束、管理员启用范围、已冻结项目配置、run override、
 *   稳定 segment override、provider/model 目录快照），不读取当前用户默认。
 * - 禁止使用关键词、字符串匹配或本地语义猜测生成 suitability；suitability 由
 *   Storyboard 阶段产出，本解析器只做机械映射。
 */

// --- 输入合同 --------------------------------------------------------------

export type GenerationOperation =
  | "topic.generate"
  | "script.generate"
  | "storyboard.generate"
  | "asset_plan.generate"
  | "assets.generate"
  | "publish.generate";

export interface SystemGenerationConstraints {
  /**
   * 系统/管理员是否启用了真实视频 provider。false 时所有 API 视频路线被强制降级为
   * remotion，包括分镜覆盖也不能绕过。
   */
  apiVideoProviderEnabled: boolean;
}

export interface ProviderModelCatalogEntry {
  /** 用户配置保存时引用的稳定模型 ID（catalog 主键）。 */
  provider_model_id: string;
  /** 该模型所属 capability slot。 */
  capability: CapabilitySlot;
  /** 服务端 provider 注册 key（不向前端暴露 base url / 凭据）。 */
  provider_key: string;
  /** provider 内部 model id。 */
  model_id: string;
  /** 模型版本，可空。 */
  model_version?: string | null;
  /** active 表示可用于新运行；disabled 表示不可用。 */
  status: "active" | "disabled";
}

export interface SegmentInput {
  segment_id: string;
  /** Storyboard 阶段产出的四档适配度。 */
  api_video_suitability: ApiVideoSuitability;
}

export interface ResolveGenerationConfigurationInput {
  /** 已冻结的项目配置（真相源）。 */
  projectConfiguration: GenerationConfigurationV1;
  projectConfigurationRevision: number;
  /**
   * 项目配置冻结时的来源用户默认 revision；只是元数据，运行时不再读取当前用户默认。
   */
  sourceUserPreferenceRevision: number | null;
  /** 单次运行覆盖，S2-2A 只允许覆盖 video/budget。 */
  runOverrides?: Partial<GenerationConfigurationV1>;
  /** 分镜级覆盖，优先级高于 run override 与项目配置，但不能绕过管理员禁用。 */
  segmentOverrides?: Record<string, SegmentVisualStrategyOverride>;
  systemConstraints: SystemGenerationConstraints;
  providerModelCatalog: ProviderModelCatalogEntry[];
  operation: GenerationOperation;
  /** 本次运行涉及的分镜及其 storyboard 适配度。 */
  segmentInputs?: SegmentInput[];
}

// --- 输出合同 --------------------------------------------------------------

export interface ResolvedProviderModel {
  mode: "auto" | "fixed";
  provider_model_id: string;
  provider_key: string;
  model_id: string;
}

export interface ResolvedSegmentVisualRoute {
  segment_id: string;
  /** Storyboard 原始适配度（只读输入）。 */
  api_video_suitability: ApiVideoSuitability;
  /** 用户覆盖值（null 表示继承）。 */
  segment_override: SegmentVisualStrategyOverride;
  /** 最终解析的实际路线。 */
  resolved_route: ResolvedVisualRoute;
  /** 确定性原因码，供审计与 trace 使用。 */
  reason_code: string;
}

export interface ResolvedGenerationConfigurationV1 {
  schema_version: "resolved_generation_configuration_v1";
  source_revisions: {
    source_user_preference_revision: number | null;
    project_configuration_revision: number;
  };
  effective: GenerationConfigurationV1;
  resolved_capabilities: Partial<Record<CapabilitySlot, ResolvedProviderModel>>;
  segment_visual_routes: ResolvedSegmentVisualRoute[];
  constraints_applied: AppliedConstraint[];
  resolution_trace: ResolutionTraceEntry[];
  configuration_hash: string;
  pricing_hash: string;
}

export type GenerationResolverErrorCode =
  | "generation_configuration_invalid"
  | "generation_capability_unavailable"
  | "generation_model_disabled"
  | "generation_model_parameter_incompatible"
  | "generation_provider_credential_unavailable"
  | "generation_system_constraint_denied";

export interface GenerationResolverError {
  code: GenerationResolverErrorCode;
  capability?: CapabilitySlot;
  message: string;
}

export type ResolveGenerationConfigurationResult =
  | { ok: true; value: ResolvedGenerationConfigurationV1 }
  | { ok: false; error: GenerationResolverError };

// --- 确定性哈希 ------------------------------------------------------------

/**
 * 稳定序列化：对象键按字典序排序，数组保持顺序，无尾随逗号/空格。
 * 用于计算 configuration_hash 与 pricing_hash，保证相同输入产出相同输出。
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalStringify(
        (value as Record<string, unknown>)[k],
      )}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * 64-bit FNV-1a 哈希（确定性、非加密）。
 * 选择 FNV-1a 而非 node:crypto 是为了让 shared 包保持无 Node 依赖；
 * 该哈希只用于检测配置/价格漂移，不承担安全用途。
 */
export function deterministicHash(input: string): string {
  // FNV-1a 64-bit (使用 BigInt 防止溢出)
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

// --- 矩阵核心 --------------------------------------------------------------

/**
 * 四档策略 × 四档适配度的视觉路线矩阵。
 *
 * 这是路线解析的**唯一**实现来源（详细设计第 5 节 + 实施计划步骤 3 表格）。
 * 任何 suitability→route 的判断必须经过本表，禁止本地语义猜测。
 */
const STRATEGY_SUITABILITY_MATRIX: Record<
  GenerationConfigurationV1["video"]["strategy"],
  Record<ApiVideoSuitability, ResolvedVisualRoute>
> = {
  all_api_video: {
    remotion_only: "remotion",
    remotion_sufficient: "api_video",
    api_video_beneficial: "api_video",
    api_video_strongly_recommended: "api_video",
  },
  prefer_api_video: {
    remotion_only: "remotion",
    remotion_sufficient: "remotion",
    api_video_beneficial: "api_video",
    api_video_strongly_recommended: "api_video",
  },
  prefer_remotion: {
    remotion_only: "remotion",
    remotion_sufficient: "remotion",
    api_video_beneficial: "remotion",
    api_video_strongly_recommended: "api_video",
  },
  all_remotion: {
    remotion_only: "remotion",
    remotion_sufficient: "remotion",
    api_video_beneficial: "remotion",
    api_video_strongly_recommended: "remotion",
  },
};

// --- capability 解析 -------------------------------------------------------

const CAPABILITY_SLOTS: CapabilitySlot[] = [
  "llm.smart",
  "llm.flash",
  "image.generate",
  "video.image_to_video",
  "tts.synthesize",
];

function resolveCapabilitySlot(
  slot: CapabilitySlot,
  config: GenerationConfigurationV1,
  catalog: ProviderModelCatalogEntry[],
):
  | { ok: true; value: ResolvedProviderModel }
  | { ok: false; error: GenerationResolverError } {
  const selection = config.capabilities[slot];
  const activeEntries = catalog.filter(
    (entry) => entry.capability === slot && entry.status === "active",
  );

  if (selection.mode === "fixed") {
    const target = catalog.find(
      (entry) => entry.provider_model_id === selection.provider_model_id,
    );
    if (!target) {
      return {
        ok: false,
        error: {
          code: "generation_capability_unavailable",
          capability: slot,
          message: `fixed provider_model_id ${selection.provider_model_id} not found in catalog for ${slot}`,
        },
      };
    }
    if (target.status !== "active") {
      return {
        ok: false,
        error: {
          code: "generation_model_disabled",
          capability: slot,
          message: `fixed provider_model_id ${selection.provider_model_id} is disabled for ${slot}`,
        },
      };
    }
    if (target.capability !== slot) {
      return {
        ok: false,
        error: {
          code: "generation_capability_unavailable",
          capability: slot,
          message: `provider_model_id ${selection.provider_model_id} does not belong to ${slot}`,
        },
      };
    }
    return {
      ok: true,
      value: {
        mode: "fixed",
        provider_model_id: target.provider_model_id,
        provider_key: target.provider_key,
        model_id: target.model_id,
      },
    };
  }

  // auto: 取该 capability 下第一个 active 条目作为平台默认。
  // 目录顺序由服务端 seed 决定；readiness 保证 active 项都能解析到 adapter/provider。
  const defaultEntry = activeEntries[0];
  if (!defaultEntry) {
    return {
      ok: false,
      error: {
        code: "generation_capability_unavailable",
        capability: slot,
        message: `no active catalog entry available for ${slot}`,
      },
    };
  }
  return {
    ok: true,
    value: {
      mode: "auto",
      provider_model_id: defaultEntry.provider_model_id,
      provider_key: defaultEntry.provider_key,
      model_id: defaultEntry.model_id,
    },
  };
}

// --- 分镜路线解析 ----------------------------------------------------------

function applyStrategyMatrix(
  strategy: GenerationConfigurationV1["video"]["strategy"],
  suitability: ApiVideoSuitability,
): ResolvedVisualRoute {
  return STRATEGY_SUITABILITY_MATRIX[strategy][suitability];
}

function resolveSegmentRoute(
  segment: SegmentInput,
  effectiveStrategy: GenerationConfigurationV1["video"]["strategy"],
  override: SegmentVisualStrategyOverride,
  apiVideoProviderEnabled: boolean,
): {
  route: ResolvedVisualRoute;
  reason_code: string;
  override_applied: boolean;
  admin_downgraded: boolean;
} {
  // 1. 管理员禁用是最高优先级的硬约束，连分镜覆盖也不能绕过。
  if (!apiVideoProviderEnabled) {
    // 如果继承策略矩阵会给出 api_video，或覆盖想要 api_video，都被降级。
    const strategyRoute = applyStrategyMatrix(effectiveStrategy, segment.api_video_suitability);
    if (override === "api_video" || strategyRoute === "api_video") {
      return {
        route: "remotion",
        reason_code: "api_video_provider_disabled",
        override_applied: false,
        admin_downgraded: true,
      };
    }
    return {
      route: "remotion",
      reason_code: "strategy_matrix_remotion",
      override_applied: false,
      admin_downgraded: false,
    };
  }

  // 2. 分镜覆盖优先于策略矩阵（但不能绕过管理员禁用，上面已处理）。
  if (override === "api_video") {
    return {
      route: "api_video",
      reason_code: "segment_override_api_video",
      override_applied: true,
      admin_downgraded: false,
    };
  }
  if (override === "remotion_motion") {
    return {
      route: "remotion",
      reason_code: "segment_override_remotion",
      override_applied: true,
      admin_downgraded: false,
    };
  }

  // 3. 继承策略矩阵。
  const route = applyStrategyMatrix(effectiveStrategy, segment.api_video_suitability);
  return {
    route,
    reason_code: `strategy_matrix_${route}`,
    override_applied: false,
    admin_downgraded: false,
  };
}

// --- 配置合并 --------------------------------------------------------------

/**
 * S2-2A run override 只允许覆盖 video 与 budget。
 * capabilities 与 creative 由项目配置决定（B/C 才开放修改）。
 */
function applyRunOverrides(
  project: GenerationConfigurationV1,
  overrides?: Partial<GenerationConfigurationV1>,
): GenerationConfigurationV1 {
  if (!overrides) {
    return project;
  }
  const merged: GenerationConfigurationV1 = {
    ...project,
    video: {
      strategy: overrides.video?.strategy ?? project.video.strategy,
      api_quality: overrides.video?.api_quality ?? project.video.api_quality,
    },
    budget: {
      currency: "CNY",
      max_paid_cost_micros_per_run:
        overrides.budget?.max_paid_cost_micros_per_run ??
        project.budget.max_paid_cost_micros_per_run,
    },
  };
  return GenerationConfigurationV1Schema.parse(merged);
}

// --- 主入口 ----------------------------------------------------------------

export function resolveGenerationConfiguration(
  input: ResolveGenerationConfigurationInput,
): ResolveGenerationConfigurationResult {
  const resolutionTrace: ResolutionTraceEntry[] = [];
  const constraintsApplied: AppliedConstraint[] = [];

  resolutionTrace.push({
    layer: "project_configuration",
    note: `used frozen project config revision ${input.projectConfigurationRevision}`,
  });

  // 1. 合并 run override。
  let effective = input.projectConfiguration;
  if (input.runOverrides) {
    effective = applyRunOverrides(input.projectConfiguration, input.runOverrides);
    resolutionTrace.push({
      layer: "run_override",
      note: "applied run overrides to video/budget",
    });
  }

  // 2. 解析 capability slot。
  const resolvedCapabilities: Partial<Record<CapabilitySlot, ResolvedProviderModel>> = {};
  for (const slot of CAPABILITY_SLOTS) {
    const result = resolveCapabilitySlot(slot, effective, input.providerModelCatalog);
    if (!result.ok) {
      return result;
    }
    resolvedCapabilities[slot] = result.value;
  }

  // 3. 解析分镜路线。
  const segmentRoutes: ResolvedSegmentVisualRoute[] = [];
  const adminDisabled = !input.systemConstraints.apiVideoProviderEnabled;
  if (adminDisabled) {
    constraintsApplied.push({
      constraint: "api_video_provider_disabled",
      note: "admin/system disabled real video provider; all api_video routes downgraded to remotion",
    });
    resolutionTrace.push({
      layer: "system_constraint",
      note: "apiVideoProviderEnabled=false",
    });
  }

  const segments = input.segmentInputs ?? [];
  let anyOverrideApplied = false;
  for (const segment of segments) {
    const rawOverride = input.segmentOverrides?.[segment.segment_id] ?? null;
    // 校验覆盖值合法性，防止任意字符串注入。
    const overrideParse = SegmentVisualStrategyOverrideSchema.safeParse(rawOverride);
    const override = overrideParse.success ? overrideParse.data : null;

    const resolved = resolveSegmentRoute(
      segment,
      effective.video.strategy,
      override,
      input.systemConstraints.apiVideoProviderEnabled,
    );
    if (resolved.override_applied) {
      anyOverrideApplied = true;
    }
    segmentRoutes.push({
      segment_id: segment.segment_id,
      api_video_suitability: segment.api_video_suitability,
      segment_override: override,
      resolved_route: resolved.route,
      reason_code: resolved.reason_code,
    });
  }
  if (anyOverrideApplied) {
    constraintsApplied.push({
      constraint: "segment_override_applied",
      note: "one or more segments use an explicit visual strategy override",
    });
  }

  // 4. 计算确定性 hash。
  const configurationPayload = {
    schema_version: "resolved_generation_configuration_v1",
    source_revisions: {
      source_user_preference_revision: input.sourceUserPreferenceRevision,
      project_configuration_revision: input.projectConfigurationRevision,
    },
    effective,
    resolved_capabilities: resolvedCapabilities,
    segment_visual_routes: segmentRoutes,
  };
  const configuration_hash = `sha256:${deterministicHash(
    canonicalStringify(configurationPayload),
  ).slice("fnv1a64:".length)}`;

  // pricing_hash 仅由 catalog 内容决定。
  const pricing_hash = `sha256:${deterministicHash(
    canonicalStringify(input.providerModelCatalog),
  ).slice("fnv1a64:".length)}`;

  const value: ResolvedGenerationConfigurationV1 = {
    schema_version: "resolved_generation_configuration_v1",
    source_revisions: {
      source_user_preference_revision: input.sourceUserPreferenceRevision,
      project_configuration_revision: input.projectConfigurationRevision,
    },
    effective,
    resolved_capabilities: resolvedCapabilities,
    segment_visual_routes: segmentRoutes,
    constraints_applied: constraintsApplied,
    resolution_trace: resolutionTrace,
    configuration_hash,
    pricing_hash,
  };

  return { ok: true, value };
}
