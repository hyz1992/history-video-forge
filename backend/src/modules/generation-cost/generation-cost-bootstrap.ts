import { env } from "../../config/env.js";
import type { DbClient } from "../../db/client.js";
import { resolveTierProviderSnapshot, type TierProviderSnapshot } from "../../runtime/llm/tier-aware-provider-factory.js";
import { readDashscopeConfig } from "../assets/assets-run.service.js";
import {
  buildPricingCatalogSeed,
  resolveDashscopeDeploymentScope,
  type DashscopeDeploymentScope,
  type LlmTierSeedInput,
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
>;

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
  demoMode: boolean;
  testEnv: boolean;
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

  if (!deps.mediaCredentialConfigured) {
    return {
      llm,
      media: {
        registeredModels: [],
        credentialConfigured: false,
        deploymentScope: "cn-beijing",
      },
      environment: { demoMode: deps.demoMode, testEnv: deps.testEnv },
    };
  }
  const media = deps.readDashscopeMediaConfig();
  const deploymentScope = resolveDashscopeDeploymentScope(media.baseUrl);
  return {
    llm,
    media: {
      registeredModels:
        deploymentScope === "unknown"
          ? [] // 区域未知：无已核实价格真相，不注册任何媒体模型（fail-closed）
          : [
              { capability: "image.generate", providerKey: "dashscope", modelId: media.imageModel },
              { capability: "video.image_to_video", providerKey: "dashscope", modelId: media.imageToVideoModel },
              { capability: "tts.synthesize", providerKey: "dashscope", modelId: media.ttsModel },
            ],
      credentialConfigured: true,
      deploymentScope,
    },
    environment: { demoMode: deps.demoMode, testEnv: deps.testEnv },
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
    demoMode: env.demoMode,
    testEnv: env.nodeEnv === "test",
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
  await applyProviderModelCatalogSeed(
    db,
    buildPricingCatalogSeed({
      llm: input.llm,
      media: { deploymentScope: input.media.deploymentScope },
    }),
  );

  const readiness = evaluateGenerationCapabilityReadiness({
    ...input,
    catalog: listProviderModelCatalog(db),
  });

  const disabledProviderModelIds = await disableProviderModelCatalogEntries(
    db,
    readiness.nonQuotableProviderModelIds,
  );

  if (!readiness.ok) {
    const codes = [...new Set(readiness.issues.map((issue) => issue.code))].join(", ");
    console.warn(
      `[generation-cost-bootstrap] readiness 未完全通过（已把不可报价项置为 disabled）: ${codes}`,
    );
  }

  return { readiness, disabledProviderModelIds: disabledProviderModelIds.sort() };
}
