/**
 * DashScope pricing configuration (CNY, China mainland).
 * Reference: https://help.aliyun.com/zh/model-studio/model-pricing
 *
 * This is the SINGLE source of truth for all cost display in the UI.
 * Components must import helpers from here — never hardcode prices.
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

export const PRICING: PricingConfig = {
  image: { unitPrice: 0.20, label: "wan2.6-t2i" },
  video720p: { unitPricePerSec: 0.60, label: "wan2.7-i2v (720P)" },
  video1080p: { unitPricePerSec: 1.00, label: "wan2.7-i2v (1080P)" },
  tts: { unitPricePer10kChars: 0.80, label: "qwen3-tts-vd" },
};

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
