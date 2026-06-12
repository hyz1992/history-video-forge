/**
 * DashScope pricing configuration (CNY, China mainland).
 * Reference: https://help.aliyun.com/zh/model-studio/model-pricing
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

const PRICING: PricingConfig = {
  image: { unitPrice: 0.20, label: "wan2.6-t2i" },
  video720p: { unitPricePerSec: 0.60, label: "wan2.7-i2v (720P)" },
  video1080p: { unitPricePerSec: 1.00, label: "wan2.7-i2v (1080P)" },
  tts: { unitPricePer10kChars: 0.80, label: "qwen3-tts-vd" },
};

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
    } else if (art.artifact_type === "video" || art.artifact_type === "video_clip") {
      const dur = (art.metadata?.duration_sec as number) ?? 0;
      videoDurationSec += dur;
      const height = (art.metadata?.height as number) ?? 720;
      if (height > 900) videoResolution = "1080P";
    } else if (art.artifact_type?.startsWith("tts")) {
      // TTS artifacts are priced by input chars, handled separately
    } else if (art.artifact_type && !["audio", "subtitle", "bgm", "sfx"].some(t => art.artifact_type?.includes(t))) {
      unpriced.push(art.artifact_type);
    }
  }

  const videoUnitPrice =
    videoResolution === "1080P"
      ? PRICING.video1080p.unitPricePerSec
      : PRICING.video720p.unitPricePerSec;

  const imageTotal = Math.round(imageCount * PRICING.image.unitPrice * 100) / 100;
  const videoTotal = Math.round(videoDurationSec * videoUnitPrice * 100) / 100;
  const ttsTotal = Math.round((ttsCharCount / 10000) * PRICING.tts.unitPricePer10kChars * 100) / 100;
  const total = Math.round((imageTotal + videoTotal + ttsTotal) * 100) / 100;

  return {
    total,
    image: { count: imageCount, unitPrice: PRICING.image.unitPrice, total: imageTotal, model: PRICING.image.label },
    video: { durationSec: videoDurationSec, resolution: videoResolution, unitPrice: videoUnitPrice, total: videoTotal, model: videoResolution === "1080P" ? PRICING.video1080p.label : PRICING.video720p.label },
    tts: { charCount: ttsCharCount, unitPrice: PRICING.tts.unitPricePer10kChars, total: ttsTotal, model: PRICING.tts.label },
    unpriced,
  };
}
