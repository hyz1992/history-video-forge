import { StoryboardPlan } from "../../../../shared/src/index.js";

/**
 * 历史分镜兼容读取边界（S2-2A 任务 4，详细设计 6.1 节）。
 *
 * decodeStoredStoryboardPlan 先尝试正式新 schema，再尝试隔离的 legacy schema。
 * 旧 visual_strategy_preference 确定性映射为只读 legacy_visual_strategy_hint：
 * - 旧 api_video → api_video_strongly_recommended
 * - 旧 remotion_motion / 缺失 → remotion_sufficient
 * 旧值不得写入 StoryboardPlan（hint 是 decoder 的独立投影，不进正式合同）。
 */

interface LegacyStoryboardPlanShape {
  plan_version: string;
  source_script_record_id: string;
  source_topic_package_id: string;
  estimated_total_duration_sec: number;
  segments: Array<Record<string, unknown>>;
  global_visual_notes: unknown[];
}

function isLegacyPlanShape(value: unknown): value is LegacyStoryboardPlanShape {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.plan_version === "storyboard_v1" &&
    typeof v.source_script_record_id === "string" &&
    typeof v.source_topic_package_id === "string" &&
    typeof v.estimated_total_duration_sec === "number" &&
    Array.isArray(v.segments) &&
    Array.isArray(v.global_visual_notes)
  );
}

/** 旧值 → 适配度语义提示的确定性映射。 */
function mapLegacyPreferenceToSuitability(
  legacy: unknown,
): "api_video_strongly_recommended" | "remotion_sufficient" {
  if (legacy === "api_video") return "api_video_strongly_recommended";
  return "remotion_sufficient";
}

/**
 * 兼容读取结果。
 * plan：可直接进入下游合同的 StoryboardPlan（不含 legacy 字段）。
 * legacy_hints：只读投影，segment_id → 历史适配度提示（旧记录才有值，新记录为空 Map）。
 */
export type DecodeStoryboardPlanResult =
  | { ok: true; value: { plan: StoryboardPlan; legacy_hints: Record<string, "api_video_strongly_recommended" | "remotion_sufficient"> } }
  | { ok: false; error: string };

export function decodeStoredStoryboardPlan(stored: unknown): DecodeStoryboardPlanResult {
  // 1. 先试正式新 schema（含 api_video_suitability，strict，无 legacy 字段）
  const modernParse = StoryboardPlan.safeParse(stored);
  if (modernParse.success) {
    return { ok: true, value: { plan: modernParse.data, legacy_hints: {} } };
  }

  // 2. 再试隔离的 legacy schema（允许 visual_strategy_preference）
  if (!isLegacyPlanShape(stored)) {
    return { ok: false, error: "invalid_storyboard_plan" };
  }

  // 含 api_video_suitability 字段的记录必须是合法新 schema（garbage 值 → 非法），
  // 不能落入 legacy 路径被静默覆盖。
  if (stored.segments.some((s) => "api_video_suitability" in s)) {
    return { ok: false, error: "invalid_storyboard_plan" };
  }

  const legacyHints: Record<string, "api_video_strongly_recommended" | "remotion_sufficient"> = {};
  const legacySegments = stored.segments.map((segment) => {
    const legacy = segment.visual_strategy_preference;
    // 旧值只映射为只读 hint 投影；suitability 用 hint 值（确定性映射）
    const hint = mapLegacyPreferenceToSuitability(legacy);
    const segmentId = typeof segment.segment_id === "string" ? segment.segment_id : "";
    if (segmentId) legacyHints[segmentId] = hint;
    // 构造新 schema 兼容的 segment（剔除旧字段，补适配度；不写 legacy 字段）
    const { visual_strategy_preference: _dropped, ...rest } = segment;
    return {
      ...rest,
      api_video_suitability: hint,
    };
  });

  const migrated = {
    plan_version: stored.plan_version,
    source_script_record_id: stored.source_script_record_id,
    source_topic_package_id: stored.source_topic_package_id,
    estimated_total_duration_sec: stored.estimated_total_duration_sec,
    segments: legacySegments,
    global_visual_notes: stored.global_visual_notes,
  };

  const migratedParse = StoryboardPlan.safeParse(migrated);
  if (!migratedParse.success) {
    return { ok: false, error: "legacy_storyboard_plan_invalid" };
  }
  return { ok: true, value: { plan: migratedParse.data, legacy_hints: legacyHints } };
}
