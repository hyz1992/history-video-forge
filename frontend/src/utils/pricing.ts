/**
 * DashScope pricing configuration (CNY, China mainland) — 前端展示参考值。
 * Reference: https://help.aliyun.com/zh/model-studio/model-pricing
 *
 * S2-2A 任务 11：本模块已降级为纯格式化/兼容层，不再是授权价格真相源。
 * - 所有本地估算只标记 `client_preview_only`，仅供用户理解常见支出；
 * - 真实付费生成的授权边界一律来自后端 quote（generation-cost-quotes API）
 *   与预算门禁，前端不得用本地价格做授权决策；
 * - 后端价格以服务端 price catalog 为准（任务 7/8），前端价格可能与实际
 *   计费存在差异。
 */

export interface CostBreakdown {
  /** Total cost in CNY */
  total: number;
  /** Per-type breakdown */
  image: { count: number; unitPrice: number; total: number; model?: string };
  video: { durationSec: number; resolution: string; unitPrice: number; total: number; model?: string };
  tts: { charCount: number; unitPrice: number; total: number; model?: string };
  /** Items that couldn't be priced */
  unpriced: string[];
}

export interface PricingConfig {
  image: { unitPrice: number; label: string };
  video720p: { unitPricePerSec: number; label: string };
  video1080p: { unitPricePerSec: number; label: string };
  tts: { unitPricePer10kChars: number; label: string };
}

/**
 * 前端展示参考价格（client_preview_only）：仅用于生成前费用预览文案，
 * 不参与任何授权/预算决策；真实提交必须使用后端 quote。
 */
export const PRICING: PricingConfig = {
  image: { unitPrice: 0.20, label: "wan2.6-t2i" },
  video720p: { unitPricePerSec: 0.60, label: "wan2.7-i2v (720P)" },
  video1080p: { unitPricePerSec: 1.00, label: "wan2.7-i2v (1080P)" },
  tts: { unitPricePer10kChars: 0.80, label: "qwen3-tts-vd" },
};

/**
 * 本地预览估算标记：任何由本模块产出的估算都只用于展示（client_preview_only），
 * 授权上界与预算比较必须来自后端 quote。
 */
export const CLIENT_PREVIEW_ONLY = true;

/**
 * Normalize a video duration for pricing estimation, matching the
 * backend provider's rounding + clamping behaviour (Math.round, 2-15s).
 */
export function normalizeVideoDurationForPricing(raw: number): number {
  const rounded = Math.round(raw);
  if (rounded < 2) return 2;
  if (rounded > 15) return 15;
  return rounded;
}

// ---------------------------------------------------------------------------
// Pre-generation estimation (from plan tasks, before manifest exists)
// ---------------------------------------------------------------------------

export interface PlanTaskLike {
  task_type: string;
  parameters?: Record<string, unknown>;
}

export interface PlanCostEstimate {
  images: number;
  videoTotalSec: number;
  ttsChars: number;
  has1080p: boolean;
  total: number;
  imgCost: number;
  vidCost: number;
  ttsCost: number;
}

/** Estimate cost from a list of plan tasks (pre-generation). */
export function estimatePlanCost(
  tasks: PlanTaskLike[],
  ttsChars: number,
): PlanCostEstimate | null {
  let images = 0;
  const videoSpecs: Array<{ dur: number; height: number }> = [];

  for (const task of tasks) {
    if (task.task_type === "image_still") images++;
    if (task.task_type === "video_clip") {
      const params = task.parameters;
      const dur = normalizeVideoDurationForPricing(
        typeof params?.duration_sec === "number" && params.duration_sec > 0
          ? params.duration_sec
          : 5,
      );
      const res =
        (typeof params?.resolution === "string" ? params.resolution : "") ||
        "720P";
      const height = res.includes("1080") ? 1080 : 720;
      videoSpecs.push({ dur, height });
    }
  }

  if (images === 0 && videoSpecs.length === 0 && ttsChars === 0) return null;

  const has1080p = videoSpecs.some((vs) => vs.height >= 1080);
  const videoTotalSec = videoSpecs.reduce((sum, vs) => sum + vs.dur, 0);

  // Use the same computeCostBreakdown by building synthetic artifacts
  const syntheticArtifacts: Array<{
    artifact_type: string;
    metadata: Record<string, unknown>;
  }> = [
    ...Array.from({ length: images }, () => ({
      artifact_type: "image",
      metadata: {},
    })),
  ];
  for (const vs of videoSpecs) {
    syntheticArtifacts.push({
      artifact_type: "video",
      metadata: { duration_sec: vs.dur, height: vs.height },
    });
  }

  const pricing = computeCostBreakdown(syntheticArtifacts, ttsChars);

  return {
    images,
    videoTotalSec,
    ttsChars,
    has1080p,
    total: pricing.total,
    imgCost: pricing.image.total,
    vidCost: pricing.video.total,
    ttsCost: pricing.tts.total,
  };
}

/**
 * 从服务端目录解析当前图片模型的单价提示（client_preview_only）。
 * 规则同 resolveVideoModelPricingHint：auto（null）解析到 is_default 条目，
 * fixed 匹配目录条目 id；unpriced 返回 null。
 */
export function resolveImageModelPricingHint(
  entries: CatalogModelEntryLike[],
  currentEntryId: string | null,
): { unitPrice: number; displayName: string; modelId: string } | null {
  const imageEntries = entries.filter(
    (entry) => entry.status === "active" && entry.availability === "enabled",
  );
  if (imageEntries.length === 0) return null;
  const current =
    (currentEntryId
      ? imageEntries.find((entry) => entry.id === currentEntryId)
      : null) ??
    imageEntries.find((entry) => entry.is_default) ??
    imageEntries[0]!;
  const micros = current.pricing?.price_micros_per_image;
  const unitPrice = typeof micros === "string" ? Number(micros) / 1_000_000 : NaN;
  if (!Number.isFinite(unitPrice)) return null;
  return {
    unitPrice,
    displayName: current.display_name,
    modelId: current.model_id,
  };
}

// ---------------------------------------------------------------------------
// Granular cost hints (single-task, missing-only, upgrade-video)
// ---------------------------------------------------------------------------

/** Human-readable cost hint for a single task type. */
export function getTaskCostHint(taskType: string): string {
  if (taskType === "image_still")
    return `约 ¥${PRICING.image.unitPrice.toFixed(2)}/张`;
  if (taskType === "video_clip")
    return `约 ¥${PRICING.video720p.unitPricePerSec.toFixed(2)}/秒`;
  return "";
}

/**
 * 服务端目录条目的前端投影（鸭子类型，避免 utils 反向依赖 store）。
 * 图片与视频条目结构一致，共用此形状。
 */
export interface CatalogModelEntryLike {
  id: string;
  model_id: string;
  display_name: string;
  status: string;
  availability: string;
  is_default: boolean;
  pricing: Record<string, unknown>;
}

/** 视频 API 质量档位（与配置合同 api_quality 枚举一致）。 */
export type VideoApiQuality = "standard_720p" | "high_1080p";

/**
 * 从服务端目录解析当前视频模型的单价提示（client_preview_only）。
 * - entries：目录 API 的 active 条目；currentEntryId 为项目配置 fixed 槽的
 *   目录条目 id（完整串），null 表示 auto（解析到 is_default 条目）。
 * - quality 指定取价档位（默认 720P）；指定档无价时回退 720P 档；
 *   完全 unpriced 返回 null，由调用方回退通用文案，避免把 unbounded 显示成金额。
 */
export function resolveVideoModelPricingHint(
  entries: CatalogModelEntryLike[],
  currentEntryId: string | null,
  quality: VideoApiQuality = "standard_720p",
): { unitPricePerSec: number; displayName: string; modelId: string } | null {
  const videoEntries = entries.filter(
    (entry) => entry.status === "active" && entry.availability === "enabled",
  );
  if (videoEntries.length === 0) return null;
  const current =
    (currentEntryId
      ? videoEntries.find((entry) => entry.id === currentEntryId)
      : null) ??
    videoEntries.find((entry) => entry.is_default) ??
    videoEntries[0]!;
  const byQuality = current.pricing
    ?.price_micros_per_second_by_quality as Record<string, unknown> | undefined;
  const micros = byQuality?.[quality] ?? byQuality?.standard_720p;
  const unitPricePerSec =
    typeof micros === "string" ? Number(micros) / 1_000_000 : NaN;
  if (!Number.isFinite(unitPricePerSec)) return null;
  return {
    unitPricePerSec,
    displayName: current.display_name,
    modelId: current.model_id,
  };
}

/** Cost hint for upgrading a segment to API video (default 720P, 5s). */
export function getVideoUpgradeCostHint(): {
  rate: string;
  estimatedTotal: number;
} {
  return {
    rate: `约 ¥${PRICING.video720p.unitPricePerSec.toFixed(2)}/秒 (720P)`,
    estimatedTotal:
      Math.round(5 * PRICING.video720p.unitPricePerSec * 100) / 100,
  };
}

/** Estimate cost for a set of blocked/missing task types. */
export function estimateBlockedItemsCost(
  items: Array<{ type: string }>,
): { imgCount: number; vidSec: number; estCost: number } {
  let imgCount = 0;
  let vidSec = 0;
  for (const item of items) {
    if (item.type === "分镜图") imgCount++;
    if (item.type === "分镜视频") vidSec += 5;
  }
  const estCost =
    Math.round(
      (imgCount * PRICING.image.unitPrice +
        vidSec * PRICING.video720p.unitPricePerSec) *
        100,
    ) / 100;
  return { imgCount, vidSec, estCost };
}

// ---------------------------------------------------------------------------
// Post-generation cost (from actual artifacts)
// ---------------------------------------------------------------------------

export interface ArtifactMeta {
  artifact_type: string;
  metadata?: Record<string, unknown>;
}

export function computeCostBreakdown(
  artifacts: ArtifactMeta[],
  ttsCharCount: number,
): CostBreakdown {
  let imageCount = 0;
  let videoDurationSec = 0;
  let videoResolution = "720P";
  const unpriced: string[] = [];

  for (const art of artifacts) {
    if (art.artifact_type === "image" || art.artifact_type === "image_still") {
      imageCount++;
    } else if (
      art.artifact_type === "video" ||
      art.artifact_type === "video_clip"
    ) {
      const dur = (art.metadata?.duration_sec as number) ?? 0;
      videoDurationSec += dur;
      const height = (art.metadata?.height as number) ?? 720;
      if (height > 900) videoResolution = "1080P";
    } else if (art.artifact_type?.startsWith("tts")) {
      // TTS artifacts are priced by input chars, handled separately
    } else if (
      art.artifact_type &&
      !["audio", "subtitle", "bgm", "sfx"].some((t) =>
        art.artifact_type?.includes(t),
      )
    ) {
      unpriced.push(art.artifact_type);
    }
  }

  const videoUnitPrice =
    videoResolution === "1080P"
      ? PRICING.video1080p.unitPricePerSec
      : PRICING.video720p.unitPricePerSec;

  const imageTotal =
    Math.round(imageCount * PRICING.image.unitPrice * 100) / 100;
  const videoTotal =
    Math.round(videoDurationSec * videoUnitPrice * 100) / 100;
  const ttsTotal =
    Math.round(
      (ttsCharCount / 10000) * PRICING.tts.unitPricePer10kChars * 100,
    ) / 100;
  const total = Math.round((imageTotal + videoTotal + ttsTotal) * 100) / 100;

  return {
    total,
    image: {
      count: imageCount,
      unitPrice: PRICING.image.unitPrice,
      total: imageTotal,
      model: PRICING.image.label,
    },
    video: {
      durationSec: videoDurationSec,
      resolution: videoResolution,
      unitPrice: videoUnitPrice,
      total: videoTotal,
      model:
        videoResolution === "1080P"
          ? PRICING.video1080p.label
          : PRICING.video720p.label,
    },
    tts: {
      charCount: ttsCharCount,
      unitPrice: PRICING.tts.unitPricePer10kChars,
      total: ttsTotal,
      model: PRICING.tts.label,
    },
    unpriced,
  };
}
