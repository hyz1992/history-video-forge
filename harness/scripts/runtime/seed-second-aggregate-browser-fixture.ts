import { randomUUID } from "node:crypto";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";

const args = new Set(process.argv.slice(2));
const ownerArgIndex = process.argv.indexOf("--owner");
const ownerEqualsArg = process.argv.find((value) => value.startsWith("--owner="));
const ownerId = (ownerArgIndex >= 0 ? process.argv[ownerArgIndex + 1] : ownerEqualsArg?.slice("--owner=".length))?.trim() ?? "";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

async function main() {
  if (!args.has("--confirm-fixture")) throw new Error("fixture_confirmation_required");
  if (!ownerId) throw new Error("fixture_owner_required");
  if (!databaseUrl) throw new Error("fixture_database_url_required");

  const client = await createPrismaClient(databaseUrl);
  try {
  const [owner, projectCount] = await Promise.all([
    client.user.findUnique({ where: { id: ownerId } }),
    client.project.count(),
  ]);
  if (!owner || owner.status !== "ACTIVE") throw new Error("fixture_owner_not_active");
  if (projectCount !== 0) throw new Error("fixture_requires_empty_project_database");

  const projectId = randomUUID();
  const topicId = randomUUID();
  const scriptId = randomUUID();
  const storyboardId = randomUUID();
  const assetPlanId = randomUUID();
  const scriptText = "鸿门宴上，项庄舞剑步步逼近。项伯以身遮挡，樊哙闯帐打断杀局。刘邦最终借故离席，但退让的代价从此埋下。";
  const segment = {
    segment_id: "sb_001", order: 0, script_excerpt: scriptText,
    start_hint_sec: 0, end_hint_sec: 30, narrative_role: "opening",
    visual_intent: "展现宴席中的逼近、遮挡与闯帐。",
    scene_description: "楚军大帐内，项庄持剑逼近，项伯横身遮挡，樊哙破门而入。",
    visual_elements: ["楚军大帐", "项庄持剑", "项伯遮挡", "樊哙闯帐"],
    framing_hint: "medium", content_type: "live_action", motion_hint: "push_in",
    editing_hint: "single", on_screen_text: [], linked_beats: ["项庄舞剑", "樊哙闯帐"],
    linked_quotes: [], risk_notes: ["保持秦汉服饰与军帐陈设。"], visual_strategy_preference: "remotion_motion",
  };
  const plan = {
    plan_version: "asset_plan_v1", source_storyboard_record_id: storyboardId,
    source_script_record_id: scriptId, source_topic_package_id: topicId,
    art_bible: {
      era_style: "秦汉之际军帐", visual_tone: "暗金火光下的压迫感",
      characters: [], locations: [], props: [], global_prompt_prefix: "秦汉历史故事，写实质感，竖屏构图",
      global_negative_prompts: ["现代服装", "现代建筑"], consistency_notes: ["人物服饰跨镜头保持一致"],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller", estimated_total_duration_sec: 30,
      chunking_strategy: "segment_boundary",
      chunks: [{ chunk_id: "tts_001", order: 0, script_excerpt: scriptText, estimated_duration_sec: 30 }],
    },
    tasks: [
      {
        task_id: "tts_001", order: 0, task_type: "tts_audio", source_segment_id: null,
        source_excerpt: scriptText, production_intent: "生成沉稳紧张的口播音频。", recommended_mode: "auto",
        provider_hint: "default_tts", prompt_draft: null, parameters: { voice_profile_id: "voice_default_male_storyteller" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [], cost_tier: "low", initial_status: "planned",
      },
      {
        task_id: "subtitle_001", order: 1, task_type: "subtitle_track", source_segment_id: null,
        source_excerpt: scriptText, production_intent: "按口播时间轴生成字幕。", recommended_mode: "auto",
        provider_hint: null, prompt_draft: null, parameters: { source_tts_task_id: "tts_001" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [], cost_tier: "free", initial_status: "planned",
      },
      {
        task_id: "img_001", order: 2, task_type: "image_still", source_segment_id: "sb_001",
        source_excerpt: scriptText, production_intent: "建立鸿门宴杀局的主视觉。", recommended_mode: "manual_allowed",
        provider_hint: "wanx", prompt_draft: "秦汉军帐宴席，项庄持剑逼近，项伯横身遮挡，樊哙破门而入，火光，紧张对峙，中景，竖屏",
        parameters: { aspect_ratio: "9:16" },
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: [] },
        risk_notes: ["避免现代器物"], cost_tier: "low", initial_status: "planned",
      },
      {
        task_id: "motion_001", order: 3, task_type: "render_motion_cue", source_segment_id: "sb_001",
        source_excerpt: scriptText, production_intent: "对主视觉执行缓慢推近。", recommended_mode: "auto",
        provider_hint: null, prompt_draft: null, parameters: { motion: "push_in" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [], cost_tier: "free", initial_status: "planned",
      },
    ],
    dependencies: [
      { dependency_id: "dep_subtitle_after_tts", task_id: "subtitle_001", depends_on_task_id: "tts_001", dependency_type: "requires_timing" },
      { dependency_id: "dep_motion_after_image", task_id: "motion_001", depends_on_task_id: "img_001", dependency_type: "requires_output" },
    ],
    cost_summary: {
      total_tasks: 4, by_type: { tts_audio: 1, subtitle_track: 1, image_still: 1, render_motion_cue: 1 },
      by_cost_tier: { free: 2, low: 2, medium: 0, high: 0 }, estimated_provider_calls: 2,
      notes: ["fixture 只验证读取与恢复，不执行 provider。"],
    },
    global_production_notes: ["浏览器验收 fixture，不代表真实模型生成质量。"],
  };

  await client.$transaction(async (tx) => {
    await tx.project.create({ data: { id: projectId, ownerId, createdById: ownerId, name: "Task 8.5-8 AssetPlan 验收", storageKey: `fixture-${projectId}`, storageDisplayName: "Task 8.5-8 AssetPlan 验收" } });
    await tx.topicPackage.create({ data: { id: topicId, projectId, title: "鸿门宴杀局", selectedAngle: "一场宴席如何逼出不可逆的阵营决裂", familyLabel: "权力博弈", scopeLabel: "秦汉之际", coreConflict: "刘邦必须从项羽的军帐中活着离开", strongScene: "项庄舞剑与樊哙闯帐", packagingSeed: "宴席上的杀机", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { label: "short" }, narrativeTensionMapJson: { hook_claim: "剑已出鞘", pressure_escalation: "项庄步步逼近", mid_reveal: "项伯横身遮挡", peak_payoff: "樊哙闯帐", ending_residue: "刘邦离席" }, mustIncludeBeatsJson: ["项庄舞剑", "樊哙闯帐"], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: ["史记·项羽本纪"], ambiguityNotesJson: [] } });
    await tx.scriptRecord.create({ data: { id: scriptId, projectId, topicPackageId: topicId, scriptText, openingSpan: "鸿门宴上，项庄舞剑步步逼近。", endingSpan: "退让的代价从此埋下。", estimatedDurationSec: 30, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} }, semanticReviewResultJson: null, executionStateJson: { generating: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null } });
    await tx.storyboardRecord.create({ data: { id: storyboardId, projectId, topicPackageId: topicId, scriptRecordId: scriptId, planJson: { plan_version: "storyboard_v1", source_script_record_id: scriptId, source_topic_package_id: topicId, estimated_total_duration_sec: 30, segments: [segment], global_visual_notes: [] } as never, validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: { segment_count: 1 } }, executionStateJson: { generating: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null } });
    await tx.assetPlanRecord.create({ data: { id: assetPlanId, projectId, topicPackageId: topicId, scriptRecordId: scriptId, storyboardRecordId: storyboardId, planJson: plan as never, validationResultJson: { stage: "asset_planning_local_validation", decision: "pass", errors: [], warnings: [], metrics: { task_count: 4 } }, executionStateJson: { generating: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: { checks: [{ code: "browser_fixture", level: "info" }] } } });
    await tx.project.update({ where: { id: projectId }, data: { status: "asset_plan_ready", activeTopicPackageId: topicId, activeScriptRecordId: scriptId, activeStoryboardRecordId: storyboardId, activeAssetPlanRecordId: assetPlanId } });
  });

  process.stdout.write(`${JSON.stringify({ status: "fixture_seeded", project_id: projectId, asset_plan_record_id: assetPlanId })}\n`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "fixture_seed_failed"}\n`);
  process.exitCode = 1;
});
