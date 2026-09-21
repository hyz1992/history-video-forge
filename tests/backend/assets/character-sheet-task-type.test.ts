/**
 * character_sheet 的两处**编译期拦不住**的接口面（2026-09-18 设计 §3.7 第 1/4 项）：
 *
 * 1. `asset-manifest-v1.schema.ts` 的平行内联枚举：漏改的表现是 manifest 解析**硬失败**，
 *    不是降级；
 * 2. `allowedArtifactTypesForTask`：漏改的表现是手动上传路径取到 undefined 后抛 TypeError/500。
 *
 * 两者都不会被 `npm run typecheck:backend` 拦住，因此必须有显式单测。
 */

import { describe, expect, it } from "vitest";

import type { AssetPlan, AssetTask } from "../../../shared/src/index.js";
import { AssetManifest, AssetTaskExecution } from "../../../shared/src/index.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import { allowedArtifactTypesForTask } from "../../../backend/src/modules/assets/assets-run.service.js";

const EMPTY_POLICY = {
  allowed: false,
  required: false,
  accepted_file_types: [] as string[],
  acceptance_notes: [] as string[],
};

function ttsTask(): AssetTask {
  return {
    task_id: "tts_001",
    order: 0,
    task_type: "tts_audio",
    source_segment_id: null,
    source_excerpt: "全片口播",
    production_intent: "生成全片口播音频",
    recommended_mode: "auto",
    provider_hint: "default_tts",
    prompt_draft: null,
    parameters: { voice_profile_id: "voice_001", chunk_ids: ["chunk_1"] },
    manual_upload_policy: EMPTY_POLICY,
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

/** 与编译器产出的 sheet 任务同构（null segment、要求 prompt_draft、手动上传开放）。 */
function sheetTask(): AssetTask {
  return {
    task_id: "sheet_001",
    order: 1,
    task_type: "character_sheet",
    source_segment_id: null,
    source_excerpt: "束发深衣",
    production_intent: "为角色「人物甲」生成定妆参考图",
    recommended_mode: "manual_allowed",
    provider_hint: null,
    prompt_draft: "角色定妆参考图「人物甲」：束发深衣",
    parameters: {
      character_id: "char_1",
      sheet_role: "character_sheet",
      aspect_ratio: "16:9",
      size: "2048*1152",
    },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["image/png", "image/jpeg"],
      acceptance_notes: [],
    },
    risk_notes: ["参考图一致性效果未经 live check 验证"],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function makePlan(tasks: AssetTask[]): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_record_1",
    source_script_record_id: "script_record_1",
    source_topic_package_id: "topic_package_1",
    art_bible: {
      era_style: "战国宫廷",
      visual_tone: "冷色压迫",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "古代中国历史短视频画面",
      global_negative_prompts: ["现代建筑"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 20,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "chunk_1", order: 0, script_excerpt: "第一段旁白", estimated_duration_sec: 20 },
      ],
    },
    tasks,
    dependencies: [],
    cost_summary: {
      total_tasks: tasks.length,
      by_type: {},
      by_cost_tier: {},
      estimated_provider_calls: tasks.length,
      notes: [],
    },
    global_production_notes: [],
  };
}

describe("character_sheet 的 manifest 接口面", () => {
  it("sheet 任务产出 manifest execution，且 manifest schema 能解析它", () => {
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: "ap_001",
      assetPlan: makePlan([ttsTask(), sheetTask()]),
      segmentIds: ["sb_001"],
    });

    const execution = manifest.executions.find((item) => item.task_type === "character_sheet");
    expect(execution).toBeDefined();
    expect(() => AssetManifest.parse(manifest)).not.toThrow();
    expect(AssetManifest.parse(manifest).executions.map((item) => item.task_type)).toContain(
      "character_sheet",
    );

    // 内联枚举确实在生效（不是 schema 松散放过）：未知取值必须被拒。
    expect(() => AssetTaskExecution.parse(execution)).not.toThrow();
    expect(() =>
      AssetTaskExecution.parse({ ...execution!, task_type: "character_sheet_v2" }),
    ).toThrow();
  });

  it("sheet 不进入任何 segment route（参考资产，不是分镜视觉位）", () => {
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: "ap_001",
      assetPlan: makePlan([ttsTask(), sheetTask()]),
      segmentIds: ["sb_001"],
    });
    expect(JSON.stringify(manifest.segment_routes)).not.toContain("sheet_001");
  });
});

describe("character_sheet 的手动上传 artifact 类型面", () => {
  it("与 image_still 同为 image（缺失时上传路径会取到 undefined 后 500）", () => {
    expect(allowedArtifactTypesForTask("character_sheet")).toEqual(["image"]);
    expect(allowedArtifactTypesForTask("image_still")).toEqual(["image"]);
  });
});
