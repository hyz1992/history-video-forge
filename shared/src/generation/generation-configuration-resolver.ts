import { z } from "zod";

import {
  type AppliedConstraint,
  type CapabilitySlot,
  type GenerationConfigurationV1,
  type ResolvedCapabilityMap,
  type ResolvedGenerationConfigurationV1,
  type ResolvedProviderModel,
  type ResolvedSegmentVisualRoute,
  type ResolutionTraceEntry,
  type SegmentVisualStrategyOverride,
  ApiVideoSuitability as ApiVideoSuitabilitySchema,
  CAPABILITY_SLOTS,
  GenerationConfigurationV1 as GenerationConfigurationV1Schema,
  ResolvedCapabilityMapSchema,
  ResolvedGenerationConfigurationV1Schema,
  ResolvedSegmentVisualRouteSchema,
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
 * - 所有非法输入必须返回结构化错误（`generation_configuration_invalid` 等），
 *   不得抛出异常或静默吞掉损坏数据/客户端错误。
 */

// --- 输入合同 --------------------------------------------------------------

export const GenerationOperationSchema = z.enum([
  "topic.generate",
  "script.generate",
  "storyboard.generate",
  "asset_plan.generate",
  "assets.generate",
  "publish.generate",
]);
export type GenerationOperation = z.infer<typeof GenerationOperationSchema>;

export const SystemGenerationConstraintsSchema = z
  .object({
    /**
     * 系统/管理员是否启用了真实视频 provider。false 时所有 API 视频路线被强制降级为
     * remotion，包括分镜覆盖也不能绕过。
     */
    apiVideoProviderEnabled: z.boolean(),
  })
  .strict();
export type SystemGenerationConstraints = z.infer<
  typeof SystemGenerationConstraintsSchema
>;

export const ProviderModelCatalogEntrySchema = z
  .object({
    /** 用户配置保存时引用的稳定模型 ID（catalog 主键）。 */
    provider_model_id: z.string().min(1),
    /** 该模型所属 capability slot。 */
    capability: z.enum(CAPABILITY_SLOTS),
    /** 服务端 provider 注册 key（不向前端暴露 base url / 凭据）。 */
    provider_key: z.string().min(1),
    /** provider 内部 model id。 */
    model_id: z.string().min(1),
    /** 模型版本，可空。 */
    model_version: z.string().min(1).nullable().optional(),
    /** active 表示可用于新运行；disabled 表示不可用。 */
    status: z.enum(["active", "disabled"]),
    /**
     * 是否为该 capability 的 auto 模式默认模型。resolver 在 auto 模式下选择
     * `is_default=true` 的 active 项；每个 capability **恰好一个** active 默认项
     * （由 resolveCapabilitySlot 校验：零个或多个都返回 generation_configuration_invalid，
     * 彻底消除对 catalog 数组顺序的依赖）。
     * 默认 false，保证不显式声明时不会意外成为默认；catalog seed 必须为每个
     * capability 显式标记恰好一个 active 默认项。
     */
    is_default: z.boolean().default(false),
  })
  .strict();
export type ProviderModelCatalogEntry = z.infer<
  typeof ProviderModelCatalogEntrySchema
>;

export const SegmentInputSchema = z
  .object({
    segment_id: z.string().min(1),
    /** Storyboard 阶段产出的四档适配度。 */
    api_video_suitability: ApiVideoSuitabilitySchema,
  })
  .strict();
export type SegmentInput = z.infer<typeof SegmentInputSchema>;

/**
 * run override 只允许覆盖 video 与 budget（S2-2A 范围）；capabilities 与 creative
 * 由项目配置决定（B/C 才开放修改）。这里用 Zod 严格刻画可覆盖字段子集。
 */
const RunOverridesSchema = z
  .object({
    video: z
      .object({
        strategy: GenerationConfigurationV1Schema.shape.video.shape.strategy.optional(),
        api_quality: GenerationConfigurationV1Schema.shape.video.shape.api_quality.optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        max_paid_cost_micros_per_run:
          GenerationConfigurationV1Schema.shape.budget.shape.max_paid_cost_micros_per_run.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const ResolveGenerationConfigurationInputSchema = z
  .object({
    /** 已冻结的项目配置（真相源）。 */
    projectConfiguration: GenerationConfigurationV1Schema,
    projectConfigurationRevision: z.number().int().nonnegative(),
    /**
     * 项目配置冻结时的来源用户默认 revision；只是元数据，运行时不再读取当前用户默认。
     */
    sourceUserPreferenceRevision: z.number().int().nonnegative().nullable(),
    /** 单次运行覆盖，S2-2A 只允许覆盖 video/budget。 */
    runOverrides: RunOverridesSchema,
    /** 分镜级覆盖，优先级高于 run override 与项目配置，但不能绕过管理员禁用。 */
    segmentOverrides: z
      .record(z.string().min(1), SegmentVisualStrategyOverrideSchema)
      .optional(),
    systemConstraints: SystemGenerationConstraintsSchema,
    providerModelCatalog: z.array(ProviderModelCatalogEntrySchema),
    operation: GenerationOperationSchema,
    /** 本次运行涉及的分镜及其 storyboard 适配度。 */
    segmentInputs: z.array(SegmentInputSchema).optional(),
  })
  .strict();
export type ResolveGenerationConfigurationInput = z.infer<
  typeof ResolveGenerationConfigurationInputSchema
>;

// --- 错误合同 --------------------------------------------------------------

export type GenerationResolverErrorCode =
  | "generation_configuration_invalid"
  | "generation_capability_unavailable"
  | "generation_model_disabled"
  | "generation_model_parameter_incompatible"
  | "generation_provider_credential_unavailable"
  | "generation_system_constraint_denied";

export interface GenerationResolverError {
  code: GenerationResolverErrorCode;
  /** 关联 capability slot（capability 类错误必填）。 */
  capability?: CapabilitySlot;
  /** 关联分镜 id（分镜覆盖类错误必填）。 */
  segment_id?: string;
  /** 面向审计与日志的公开原因，不得包含凭据细节。 */
  message: string;
}

export type ResolveGenerationConfigurationResult =
  | { ok: true; value: ResolvedGenerationConfigurationV1 }
  | { ok: false; error: GenerationResolverError };

// --- catalog 规范化（用于稳定 hash） ---------------------------------------

/**
 * 将 catalog 规范化为按 `provider_model_id` 排序、主键唯一的数组，供 catalog_hash
 * 使用。catalog 在语义上是按稳定 ID 标识的集合，直接哈希原始数组会让数据库返回顺序
 * 变化被误判为目录漂移（P1-2 整改）。
 *
 * 返回结果结构：
 * - ok=true：规范化的 catalog 数组（仅含参与 hash 的字段，按主键字典序排序）。
 * - ok=false：存在重复 provider_model_id，返回结构化错误。
 */
function normalizeCatalogForHash(
  catalog: ProviderModelCatalogEntry[],
):
  | { ok: true; value: Array<Record<string, unknown>> }
  | { ok: false; error: GenerationResolverError } {
  const seen = new Set<string>();
  const normalized: Array<Record<string, unknown>> = [];
  for (const entry of catalog) {
    if (seen.has(entry.provider_model_id)) {
      return {
        ok: false,
        error: {
          code: "generation_configuration_invalid",
          message: `duplicate provider_model_id in catalog: ${entry.provider_model_id}`,
        },
      };
    }
    seen.add(entry.provider_model_id);
    // 只保留参与 hash 的语义字段（不含可能漂移的元数据如 updated_at）。
    normalized.push({
      provider_model_id: entry.provider_model_id,
      capability: entry.capability,
      provider_key: entry.provider_key,
      model_id: entry.model_id,
      model_version: entry.model_version ?? null,
      status: entry.status,
      is_default: entry.is_default,
    });
  }
  // 使用 UTF-16 code-unit 比较（a < b / a > b），而非 localeCompare。
  // localeCompare 依赖运行环境默认 locale，跨节点或非 ASCII ID 时排序可能不同，
  // 导致相同 catalog 产出不同 hash（P2 整改）。
  normalized.sort((a, b) => {
    const aid = String(a.provider_model_id);
    const bid = String(b.provider_model_id);
    if (aid < bid) return -1;
    if (aid > bid) return 1;
    return 0;
  });
  return { ok: true, value: normalized };
}

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
 * 64-bit FNV-1a 漂移检测 hash（确定性、非加密）。
 *
 * 用途边界（P1-2 整改，务必遵守）：
 * - **仅用于漂移检测**：configuration_hash / catalog_hash 在提交时由服务端重新解析
 *   并比对，确认 quote 基于的配置/目录未被改过。这是确定性比对，不是密码学防伪。
 * - **不得用于授权边界或防篡改指纹**：付费 quote 的加密级绑定由任务 8 在提交事务
 *   中生成的 `quote_fingerprint`（SHA-256）承担，不复用本函数输出。
 * - **不得用于定价 hash**：价格变化检测由任务 7 PricingService 基于 normalized 价格
 *   内容生成 pricing_hash，resolver 不产出。
 *
 * 选择 FNV-1a 而非 node:crypto 是为了让 shared 包保持无 Node 依赖、resolver 保持
 * 纯同步纯函数。漂移检测不需要加密强度：攻击面要求能控制服务端 canonical JSON 的
 * 计算结果，而 canonical JSON 由服务端确定性生成（见 canonicalStringify）。
 * 返回值带 `fnv1a64:` 前缀，明确标识算法，便于审计判断算法强度。
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

type VideoStrategyValue = GenerationConfigurationV1["video"]["strategy"];
type ApiVideoSuitabilityValue = z.infer<typeof ApiVideoSuitabilitySchema>;
type VisualRoute = "api_video" | "remotion";

/**
 * 四档策略 × 四档适配度的视觉路线矩阵。
 *
 * 这是路线解析的**唯一**实现来源（详细设计第 5 节 + 实施计划步骤 3 表格）。
 * 任何 suitability→route 的判断必须经过本表，禁止本地语义猜测。
 */
const STRATEGY_SUITABILITY_MATRIX: Record<
  VideoStrategyValue,
  Record<ApiVideoSuitabilityValue, VisualRoute>
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

  // auto: 选择该 capability 下 is_default=true 的 active 条目作为平台默认。
  // 关键约束（P1 整改）：每个 capability **恰好一个** active 默认项。
  //   - 多于一个：seed 漂移，返回结构化错误。
  //   - 零个：catalog seed 不完整，返回结构化错误（不再退回数组首项，彻底消除
  //     对数据库返回顺序的依赖——这是 auto 选择稳定性的硬合同）。
  // 这保证相同 catalog 内容（无论行顺序）永远解析出相同默认模型/价格/hash。
  if (activeEntries.length === 0) {
    return {
      ok: false,
      error: {
        code: "generation_capability_unavailable",
        capability: slot,
        message: `no active catalog entry available for ${slot}`,
      },
    };
  }
  const defaultEntries = activeEntries.filter((entry) => entry.is_default);
  if (defaultEntries.length === 0) {
    return {
      ok: false,
      error: {
        code: "generation_configuration_invalid",
        capability: slot,
        message: `capability ${slot} has no active default entry; auto mode requires exactly one is_default=true active entry per capability`,
      },
    };
  }
  if (defaultEntries.length > 1) {
    return {
      ok: false,
      error: {
        code: "generation_configuration_invalid",
        capability: slot,
        message: `capability ${slot} has ${defaultEntries.length} active default entries; expected exactly one`,
      },
    };
  }
  const defaultEntry = defaultEntries[0]!;
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
  suitability: ApiVideoSuitabilityValue,
): VisualRoute {
  return STRATEGY_SUITABILITY_MATRIX[strategy][suitability];
}

interface SegmentRouteDecision {
  route: VisualRoute;
  reason_code: string;
  override_applied: boolean;
  admin_downgraded: boolean;
}

function resolveSegmentRoute(
  segment: SegmentInput,
  effectiveStrategy: GenerationConfigurationV1["video"]["strategy"],
  override: SegmentVisualStrategyOverride,
  apiVideoProviderEnabled: boolean,
): SegmentRouteDecision {
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
 *
 * 输入已由 ResolveGenerationConfigurationInputSchema 校验过 runOverrides 形状，
 * 因此这里不再 try/catch；若合并结果违反 GenerationConfigurationV1（例如 override
 * 把 budget 改成非法值），由主入口的 safeParse 兜底返回结构化错误。
 */
function applyRunOverrides(
  project: GenerationConfigurationV1,
  overrides: NonNullable<ResolveGenerationConfigurationInput["runOverrides"]>,
): GenerationConfigurationV1 {
  return {
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
}

// --- 主入口 ----------------------------------------------------------------

export function resolveGenerationConfiguration(
  rawInput: unknown,
): ResolveGenerationConfigurationResult {
  // 0. 全输入运行时校验：损坏的项目配置、catalog、system constraints、覆盖值等
  //    统一在这里转成结构化错误，禁止后续逻辑因 undefined 字段抛 TypeError。
  const parsedInput = ResolveGenerationConfigurationInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: {
        code: "generation_configuration_invalid",
        message: `invalid resolver input: ${parsedInput.error.message}`,
      },
    };
  }
  const input = parsedInput.data;

  const resolutionTrace: ResolutionTraceEntry[] = [];
  const constraintsApplied: AppliedConstraint[] = [];

  resolutionTrace.push({
    layer: "project_configuration",
    note: `used frozen project config revision ${input.projectConfigurationRevision}`,
  });

  // 1. 合并 run override，并对合并后的 effective 配置再做一次完整校验。
  let effective = input.projectConfiguration;
  if (input.runOverrides) {
    const merged = applyRunOverrides(input.projectConfiguration, input.runOverrides);
    const mergedParse = GenerationConfigurationV1Schema.safeParse(merged);
    if (!mergedParse.success) {
      return {
        ok: false,
        error: {
          code: "generation_configuration_invalid",
          message: `merged run override produced invalid configuration: ${mergedParse.error.message}`,
        },
      };
    }
    effective = mergedParse.data;
    resolutionTrace.push({
      layer: "run_override",
      note: "applied run overrides to video/budget",
    });
  }

  // 2. 解析五个 capability slot，产出完整 ResolvedCapabilityMap。
  const resolvedCapabilitiesPartial: Partial<Record<CapabilitySlot, ResolvedProviderModel>> = {};
  for (const slot of CAPABILITY_SLOTS) {
    const result = resolveCapabilitySlot(slot, effective, input.providerModelCatalog);
    if (!result.ok) {
      return result;
    }
    resolvedCapabilitiesPartial[slot] = result.value;
  }
  // 强类型校验：resolved_capabilities 必须为五个 slot 各提供一个已解析 provider/model。
  const resolvedCapabilitiesParse = ResolvedCapabilityMapSchema.safeParse(resolvedCapabilitiesPartial);
  if (!resolvedCapabilitiesParse.success) {
    return {
      ok: false,
      error: {
        code: "generation_configuration_invalid",
        message: `resolved capabilities map is incomplete: ${resolvedCapabilitiesParse.error.message}`,
      },
    };
  }
  const resolvedCapabilities: ResolvedCapabilityMap = resolvedCapabilitiesParse.data;

  // 3. 解析分镜路线。非法覆盖值已在输入 schema 阶段被拒绝（不会进入这里）；
  //    segment_override 为 null 表示继承项目策略。
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
    const override: SegmentVisualStrategyOverride =
      input.segmentOverrides?.[segment.segment_id] ?? null;

    const decision = resolveSegmentRoute(
      segment,
      effective.video.strategy,
      override,
      input.systemConstraints.apiVideoProviderEnabled,
    );
    if (decision.override_applied) {
      anyOverrideApplied = true;
    }
    segmentRoutes.push({
      segment_id: segment.segment_id,
      api_video_suitability: segment.api_video_suitability,
      segment_override: override,
      resolved_route: decision.route,
      reason_code: decision.reason_code,
    });
  }
  if (anyOverrideApplied) {
    constraintsApplied.push({
      constraint: "segment_override_applied",
      note: "one or more segments use an explicit visual strategy override",
    });
  }

  // 4. 计算确定性漂移检测 hash。
  //    - configuration_hash：resolved 配置的 canonical JSON hash，用于提交时比对
  //      配置是否漂移（quote 基于的配置是否被改过）。
  //    - catalog_hash：provider/model 目录内容的 canonical JSON hash（不含价格），
  //      用于检测目录漂移。价格变化检测由任务 7 PricingService 的 pricing_hash 承担，
  //      resolver 不产出定价 hash。
  //    两者都用 FNV-1a64，只做漂移检测；加密级 quote 绑定由任务 8 quote_fingerprint 承担。
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
  const configuration_hash = deterministicHash(canonicalStringify(configurationPayload));
  // catalog 在语义上是按 provider_model_id 标识的集合，不是有序数组。
  // 直接哈希数组会让数据库返回顺序变化被误判为目录漂移，导致有效 quote 被拒绝。
  // 因此先按稳定主键排序、校验唯一，再计算 hash（P1-2 整改）。
  const catalogForHash = normalizeCatalogForHash(input.providerModelCatalog);
  if (!catalogForHash.ok) {
    return { ok: false, error: catalogForHash.error };
  }
  const catalog_hash = deterministicHash(canonicalStringify(catalogForHash.value));

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
    catalog_hash,
  };

  // 最终输出再过一次强类型 schema 校验，确保 resolver 产出永远满足合同。
  const outputParse = ResolvedGenerationConfigurationV1Schema.safeParse(value);
  if (!outputParse.success) {
    return {
      ok: false,
      error: {
        code: "generation_configuration_invalid",
        message: `resolver produced invalid output: ${outputParse.error.message}`,
      },
    };
  }

  return { ok: true, value: outputParse.data };
}
