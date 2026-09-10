import { NARRATION_FIRST_MODEL_POLICY_V1 } from "../narration/narration-model-policy.js";
import { env } from "../../config/env.js";
import path from "node:path";
import type { DbClient } from "../../db/client.js";
import { resolveTierProviderSnapshot, type TierProviderSnapshot } from "../../runtime/llm/tier-aware-provider-factory.js";
import { loadProviderRegistry } from "../../runtime/llm/provider-registry.js";
import { resolveTierModel } from "../../runtime/llm/tier-resolver.js";
import { readDashscopeConfig } from "../assets/assets-run.service.js";
import {
  buildPricingCatalogSeed,
  DASHSCOPE_MEDIA_CANDIDATES_V1,
  resolveDashscopeDeploymentScope,
  type DashscopeDeploymentScope,
  type LlmTierSeedInput,
  type MediaAdditionalModel,
} from "./pricing-catalog.seed.js";
import {
  applyProviderModelCatalogSeed,
  disableProviderModelCatalogEntries,
  listProviderModelCatalog,
} from "./provider-model-catalog.repository.js";
import {
  evaluateGenerationCapabilityReadiness,
  type GenerationCapabilityReadinessInput,
  type GenerationCapabilityReadinessResult,
} from "./generation-capability-readiness.js";
import { LLM_MODEL_CANDIDATES_V1, type LlmModelCandidate } from "./llm-model-catalog.js";

/**
 * S2-2A 任务 7 重开（codex 审计 P1-1）：生成成本目录启动 bootstrap。
 *
 * 在服务启动的 Prisma hydrate 之后执行：
 * 1. 用当前真实运行配置（LLM tier 解析、DashScope 媒体配置、凭据、环境）
 *    构建服务端受控 seed 并应用（禁用迁移占位行；Prisma 批量事务原子生效）。
 * 2. 执行 readiness 交叉校验（tier/providers.json/媒体支持矩阵/凭据/默认项唯一性）。
 * 3. 把不可报价项物化为目录 disabled：目录 API（只返回 active）不再公开它们，
 *    报价与派发边界消费同一目录状态。环境恢复后下次启动 seed 自动纠正。
 *
 * 失败语义：seed 持久化失败向上传播 = 启动失败（fail-closed，与迁移/hydrate
 * 失败同等对待）；readiness 本身是纯函数，其结果只反映为目录状态与启动日志，
 * 不阻断启动（demo/test 环境必然存在视频禁派发约束，属正常运行状态）。
 * 日志只输出公开原因码，不含密钥、apiKeyEnv 引用或环境变量名。
 */

export type GenerationCostBootstrapInput = Omit<
  GenerationCapabilityReadinessInput,
  "catalog"
> & {
  /**
   * S2-2C（§7.2）：媒体 additionalModels（seed 输入透传，不属 readiness 校验）。
   * 首版为空数组（接口就位，不伪造模型）。
   */
  mediaAdditionalModels?: MediaAdditionalModel[];
};

export interface GenerationCostBootstrapResult {
  readiness: GenerationCapabilityReadinessResult;
  /** 本次被物化为 disabled 的目录项 id。 */
  disabledProviderModelIds: string[];
}

/** DashScope 媒体运行配置的最小投影（来自 readDashscopeConfig，env 覆盖后的真实执行模型）。 */
export interface DashscopeMediaConfigProjection {
  imageModel: string;
  imageToVideoModel: string;
  ttsModel: string;
  /** 运行时 baseUrl（undefined = SDK 默认北京接入）。 */
  baseUrl: string | undefined;
}

export interface GenerationCostBootstrapEnvDeps {
  /** env.llm.provider（"stub" 走本地零费用路径）。 */
  llmProvider: string;
  /** tier 解析（providers.json + 凭据健康由其内部保证；抛错映射为 resolution_failed）。 */
  resolveTierSnapshot: () => TierProviderSnapshot;
  /** env.generation.mediaCredentialConfigured。 */
  mediaCredentialConfigured: boolean;
  /** DashScope 媒体运行配置（只在凭据已配置时才会被调用）。 */
  readDashscopeMediaConfig: () => DashscopeMediaConfigProjection;

  testEnv: boolean;
  /**
   * S2-2C（§7.1）：本轮 LLM 候选声明（缺省 = 不种候选，兼容旧调用方/测试）。
   * 生产绑定传 LLM_MODEL_CANDIDATES_V1。
   */
  llmCandidates?: LlmModelCandidate[];
  /**
   * S2-2C（§7.1）：候选连接预解析（provider 注册 + 凭据健康检查）。
   * 失败返回 ok:false → 该候选不种入目录（只输出公开原因日志，失败详情
   * 可能含 env 变量名，不得外泄）。
   */
  resolveCandidateModel?: (candidate: LlmModelCandidate) => { ok: true } | { ok: false };
  /** S2-2C（§7.2）：媒体 additionalModels（首版空数组）。 */
  mediaAdditionalModels?: MediaAdditionalModel[];
}

/**
 * 从当前 env/运行配置推导 bootstrap 输入（可注入依赖，便于测试）。
 *
 * 媒体支持矩阵只包含当前实际构建 adapter 会使用的模型（与 assets-run
 * buildProviderRegistry 的启用条件一致：凭据存在才有真实 DashScope adapter）。
 * 部署区域由运行 baseUrl 推导并贯穿 seed 与 readiness；未知区域 fail-closed
 * （媒体矩阵为空、seed 不种媒体行）。
 */
export function resolveGenerationCostBootstrapInput(
  deps: GenerationCostBootstrapEnvDeps,
): GenerationCostBootstrapInput {
  let llm: LlmTierSeedInput;
  if (deps.llmProvider === "stub") {
    llm = { mode: "stub" };
  } else {
    try {
      const snapshot = deps.resolveTierSnapshot();
      llm = {
        mode: "resolved",
        smart: { providerKey: snapshot.smart.provider, modelId: snapshot.smart.model },
        flash: snapshot.flash
          ? { providerKey: snapshot.flash.provider, modelId: snapshot.flash.model }
          : { reusesSmart: true },
      };
    } catch {
      llm = { mode: "resolution_failed" };
    }
  }

  // S2-2C（§7.1）：候选预解析——resolveCandidateModel 失败的候选不种入目录
  // （provider 未注册 / 凭据缺失），只输出公开原因诊断日志（失败详情可能含
  // env 变量名，不外泄）；stub 模式不种候选。
  let llmCandidates: LlmModelCandidate[] | undefined;
  if (deps.llmProvider !== "stub" && deps.llmCandidates && deps.llmCandidates.length > 0) {
    llmCandidates = [];
    for (const candidate of deps.llmCandidates) {
      const resolved = deps.resolveCandidateModel?.(candidate) ?? { ok: true };
      if (resolved.ok) {
        llmCandidates.push(candidate);
      } else {
        console.warn(
          `[generation-cost-bootstrap] LLM 候选 (${candidate.providerKey}:${candidate.modelId}) 预解析失败（provider 未注册或服务端凭据缺失），不种入目录`,
        );
      }
    }
  }

  if (!deps.mediaCredentialConfigured) {
    return {
      llm,
      llmCandidates,
      media: {
        registeredModels: [],
        credentialConfigured: false,
        deploymentScope: "cn-beijing",
      },
      environment: { testEnv: deps.testEnv },
      mediaAdditionalModels: deps.mediaAdditionalModels ?? [],
    };
  }
  const media = deps.readDashscopeMediaConfig();
  const deploymentScope = resolveDashscopeDeploymentScope(media.baseUrl);
  // S2-2C（§7.2）：registeredModels 扩展为候选集（内置候选 ∪ env 默认 ∪ additionalModels），
  // 目录项与候选集精确匹配的 readiness 校验随目录多候选一起生效。
  // 内置候选 DASHSCOPE_MEDIA_CANDIDATES_V1 与 seed 同源：不并入矩阵会出现
  // "目录行被判未注册 → 物化 disabled → 前端候选不可见"（wan2.6-i2v-flash 回归）。
  const additionalModels: MediaAdditionalModel[] = [
    ...DASHSCOPE_MEDIA_CANDIDATES_V1,
    ...(deps.mediaAdditionalModels ?? []),
  ];
  return {
    llm,
    llmCandidates,
    media: {
      registeredModels:
        deploymentScope === "unknown"
          ? [] // 区域未知：无已核实价格真相，不注册任何媒体模型（fail-closed）
          : [
              ...additionalModels.map((m) => ({
                capability: m.capability,
                providerKey: m.providerKey,
                modelId: m.modelId,
              })),
              { capability: "image.generate", providerKey: "dashscope", modelId: media.imageModel },
              { capability: "video.image_to_video", providerKey: "dashscope", modelId: media.imageToVideoModel },
              { capability: "tts.synthesize", providerKey: "dashscope", modelId: media.ttsModel },
            ],
      credentialConfigured: true,
      deploymentScope,
    },
    environment: { testEnv: deps.testEnv },
    mediaAdditionalModels: additionalModels,
  };
}

/** 生产绑定：从真实 env / tier resolver / DashScope 运行配置推导。 */
export function resolveGenerationCostBootstrapInputFromEnv(): GenerationCostBootstrapInput {
  return resolveGenerationCostBootstrapInput({
    llmProvider: env.llm.provider,
    resolveTierSnapshot: resolveTierProviderSnapshot,
    mediaCredentialConfigured: env.generation.mediaCredentialConfigured,
    readDashscopeMediaConfig: () => {
      const config = readDashscopeConfig(undefined);
      return {
        imageModel: config.imageModel,
        imageToVideoModel: config.imageToVideoModel,
        ttsModel: config.ttsModel,
        baseUrl: config.baseUrl,
      };
    },
    testEnv: env.nodeEnv === "test",
    llmCandidates: LLM_MODEL_CANDIDATES_V1,
    resolveCandidateModel: (candidate) => {
      const configPath =
        env.llm.providersConfigPath ??
        path.resolve(process.cwd(), "backend/providers.json");
      try {
        resolveTierModel({
          tier: "smart",
          tierModelRaw: `${candidate.providerKey}:${candidate.modelId}`,
          registry: loadProviderRegistry({
            configPath,
            envFallback: { baseUrl: env.llm.baseUrl, apiKey: env.llm.apiKey },
          }),
          env: process.env as Record<string, string | undefined>,
          fallbackApiKey: env.llm.apiKey,
        });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    // S2-2C（§7.2）：媒体候选接口就位，首版空数组（不伪造模型）
    mediaAdditionalModels: [],
  });
}

/**
 * 应用 seed → readiness → 物化不可报价项。
 * 调用前提：db.providerModelCatalog 已完成 Prisma hydrate（占位行在 Map 中可见）。
 */
export async function bootstrapGenerationCostCatalog(
  db: DbClient,
  input: GenerationCostBootstrapInput,
): Promise<GenerationCostBootstrapResult> {
  const { mediaAdditionalModels = [], ...readinessInput } = input;
  await applyProviderModelCatalogSeed(
    db,
    buildPricingCatalogSeed({
      llm: { ...input.llm, candidates: input.llmCandidates },
      media: {
        deploymentScope: input.media.deploymentScope,
        additionalModels: mediaAdditionalModels,
      },
    }),
  );

  const readiness = evaluateGenerationCapabilityReadiness({
    ...readinessInput,
    catalog: listProviderModelCatalog(db),
  });

  // 旧readiness衡量HTTP执行能力；独立WS目录只按正式资格身份和部署上下文保留。
  // 不修改readiness的拒绝结果，目录active绝不授予旧dispatch WS执行权限。
  const qualifiedWsIds = new Set(NARRATION_FIRST_MODEL_POLICY_V1.qualified_options
    .filter(option => {
      const entry = db.providerModelCatalog.get(option.provider_model_id);
      const meta = entry?.parameterCapabilitiesJson;
      return input.media.credentialConfigured && input.media.deploymentScope === option.region &&
        entry?.modelId === option.model && entry.providerKey === "dashscope" &&
        entry.capability === "tts.synthesize" && !entry.isDefault &&
        meta?.execution_protocol === option.protocol && meta?.narration_only === true &&
        meta?.deployment_scope === option.region;
    }).map(option => option.provider_model_id));
  const disabledProviderModelIds = await disableProviderModelCatalogEntries(
    db,
    readiness.nonQuotableProviderModelIds.filter(id => !qualifiedWsIds.has(id)),
  );

  if (!readiness.ok) {
    const codes = [...new Set(readiness.issues.map((issue) => issue.code))].join(", ");
    console.warn(
      `[generation-cost-bootstrap] 旧执行能力检查未完全通过（不可用目录已禁用，合格WS候选按独立策略保留）: ${codes}`,
    );
  }

  return { readiness, disabledProviderModelIds: disabledProviderModelIds.sort() };
}
