import { describe, expect, it } from "vitest";

import type { AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator.js";

const scriptText =
  "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。";

const baseStoryboardPlan: StoryboardPlan = {
  plan_version: "storyboard_v1",
  source_script_record_id: "script_record_1",
  source_topic_package_id: "topic_package_1",
  estimated_total_duration_sec: 70,
  segments: [
    {
      segment_id: "sb_001",
      order: 0,
      script_excerpt:
        "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。",
      start_hint_sec: 0,
      end_hint_sec: 18,
      narrative_role: "opening",
      visual_intent: "让观众看见公开羞辱已经落到晏子身上。",
      scene_description: "楚国殿前，矮门和众人的目光形成压迫。",
      visual_elements: ["楚王", "晏子", "矮门"],
      framing_hint: "wide",
      content_type: "live_action",
      motion_hint: "push_in",
      editing_hint: "single",
      on_screen_text: ["第一次压场"],
      linked_beats: ["狗门羞辱"],
      linked_quotes: [],
      risk_notes: [],
    },
    {
      segment_id: "sb_002",
      order: 1,
      script_excerpt:
        "第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。",
      start_hint_sec: 18,
      end_hint_sec: 40,
      narrative_role: "pressure",
      visual_intent: "让观众看见羞辱从个人升到齐国。",
      scene_description: "殿上对峙，晏子用礼制把话压回去。",
      visual_elements: ["楚王", "晏子", "群臣"],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: "static",
      editing_hint: "cutaway",
      on_screen_text: [],
      linked_beats: ["齐国无人"],
      linked_quotes: [],
      risk_notes: [],
    },
    {
      segment_id: "sb_003",
      order: 2,
      script_excerpt:
        "最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。",
      start_hint_sec: 40,
      end_hint_sec: 70,
      narrative_role: "ending",
      visual_intent: "让观众看见第三次压场被原样顶回去。",
      scene_description: "橘与枳的对照压过殿上的嘲笑。",
      visual_elements: ["橘", "晏子", "楚王"],
      framing_hint: "close",
      content_type: "illustration",
      motion_hint: "pull_back",
      editing_hint: "montage",
      on_screen_text: ["橘生淮南则为橘"],
      linked_beats: ["橘枳之喻"],
      linked_quotes: ["橘生淮南则为橘"],
      risk_notes: [],
    },
  ],
  global_visual_notes: [],
};

function makeBaseAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_record_1",
    source_script_record_id: "script_record_1",
    source_topic_package_id: "topic_package_1",
    art_bible: {
      era_style: "战国宫廷与军帐",
      visual_tone: "冷色压迫，转折处用暖光突出人物反应",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "古代中国历史短视频画面，战国质感",
      global_negative_prompts: ["现代建筑"],
      consistency_notes: [],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 70,
      chunking_strategy: "segment_boundary",
      chunks: baseStoryboardPlan.segments.map((segment) => ({
        chunk_id: `tts_${segment.order + 1}`,
        order: segment.order,
        script_excerpt: segment.script_excerpt,
        estimated_duration_sec: segment.end_hint_sec - segment.start_hint_sec,
      })),
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "生成全片口播音频",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: {
          voice_profile_id: "voice_default_male_storyteller",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "subtitle_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "根据 TTS 时间戳生成字幕轨",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          format: "srt",
          source_tts_task_id: "tts_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: baseStoryboardPlan.segments[0].script_excerpt,
        production_intent: "表现狗门羞辱的压迫感",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: "战国宫门前，齐国使节站在低矮狗洞前，众人注视",
        parameters: {
          aspect_ratio: "9:16",
          image_role: "anchor",
          support_reason: null,
          video_prompt_reserve: "缓慢推进，突出狗门与众人目光",
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png", "image/jpeg"],
          acceptance_notes: [],
        },
        risk_notes: ["避免现代建筑和服饰，保持战国历史质感"],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "motion_001",
        order: 3,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: baseStoryboardPlan.segments[0].script_excerpt,
        production_intent: "对静态图做缓慢推进",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          recipe_type: "push_in",
          source_image_task_id: "img_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: ["运镜保持平稳，避免破坏历史正剧质感"],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "video_001",
        order: 4,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: baseStoryboardPlan.segments[0].script_excerpt,
        production_intent: "表现橘枳之喻的高潮转折",
        recommended_mode: "manual_preferred",
        provider_hint: "video_provider",
        prompt_draft: "战国大殿上，晏子用橘枳之喻反击楚王，群臣安静",
        parameters: {
          static_fallback_task_id: "img_001",
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["video/mp4"],
          acceptance_notes: [],
        },
        risk_notes: ["避免夸张血腥或奇幻化表现"],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [
      {
        dependency_id: "dep_subtitle_after_tts",
        task_id: "subtitle_001",
        depends_on_task_id: "tts_001",
        dependency_type: "requires_timing",
      },
      {
        dependency_id: "dep_motion_after_image",
        task_id: "motion_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
      {
        dependency_id: "dep_video_after_image",
        task_id: "video_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
    ],
    cost_summary: {
      total_tasks: 5,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        render_motion_cue: 1,
        video_clip: 1,
      },
      by_cost_tier: {
        free: 2,
        low: 2,
        medium: 0,
        high: 1,
      },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: ["不生成物理文件，只生成任务合同"],
  };
}

function runValidation(plan: AssetPlan) {
  return validateAssetPlan({
    storyboardRecordId: "storyboard_record_1",
    scriptRecordId: "script_record_1",
    topicPackageId: "topic_package_1",
    storyboard: baseStoryboardPlan,
    scriptText,
    plan,
  });
}

describe("validateAssetPlan", () => {
  it("passes a structurally valid asset plan", () => {
    const baseAssetPlan = makeBaseAssetPlan();

    const result = runValidation(baseAssetPlan);

    expect(result.decision).toBe("pass");
    expect(result.errors).toEqual([]);
    expect(result.metrics).toMatchObject({
      task_count: baseAssetPlan.tasks.length,
      dependency_count: baseAssetPlan.dependencies.length,
    });
  });

  it.each([
    [
      "asset_plan_source_storyboard_mismatch",
      (plan: AssetPlan) => {
        plan.source_storyboard_record_id = "other_storyboard";
      },
    ],
    [
      "asset_plan_source_script_mismatch",
      (plan: AssetPlan) => {
        plan.source_script_record_id = "other_script";
      },
    ],
    [
      "asset_plan_source_topic_mismatch",
      (plan: AssetPlan) => {
        plan.source_topic_package_id = "other_topic";
      },
    ],
    [
      "asset_task_id_duplicate",
      (plan: AssetPlan) => {
        plan.tasks[1].task_id = plan.tasks[0].task_id;
      },
    ],
    [
      "asset_task_order_invalid",
      (plan: AssetPlan) => {
        plan.tasks[2].order = 7;
      },
    ],
    [
      "asset_task_source_segment_invalid",
      (plan: AssetPlan) => {
        plan.tasks[2].source_segment_id = "missing_segment";
      },
    ],
    [
      "asset_dependency_task_missing",
      (plan: AssetPlan) => {
        plan.dependencies[0].depends_on_task_id = "missing_task";
      },
    ],
    [
      "asset_dependency_cycle_detected",
      (plan: AssetPlan) => {
        plan.dependencies.push({
          dependency_id: "dep_cycle",
          task_id: "img_001",
          depends_on_task_id: "motion_001",
          dependency_type: "requires_output",
        });
      },
    ],
    [
      "asset_tts_script_coverage_missing",
      (plan: AssetPlan) => {
        // 让某个 chunk 的 script_excerpt 在原文中完全找不到（hasMissingExcerpt）
        plan.tts_plan.chunks[0]!.script_excerpt = "这段文本在原 script 中不存在";
      },
    ],
    [
      "asset_subtitle_missing_tts_dependency",
      (plan: AssetPlan) => {
        plan.dependencies = plan.dependencies.filter(
          (dependency) => dependency.task_id !== "subtitle_001",
        );
      },
    ],
    [
      "asset_visual_prompt_missing",
      (plan: AssetPlan) => {
        plan.tasks[2].prompt_draft = "" as never;
      },
    ],
    [
      "asset_visual_risk_notes_missing",
      (plan: AssetPlan) => {
        plan.tasks[3].risk_notes = [];
      },
    ],
    [
      "asset_video_missing_static_fallback",
      (plan: AssetPlan) => {
        plan.dependencies = plan.dependencies.filter(
          (dependency) => dependency.task_id !== "video_001",
        );
        delete (plan.tasks[4].parameters as Record<string, unknown>).static_fallback_task_id;
      },
    ],
    [
      "asset_dependency_timing_source_invalid",
      (plan: AssetPlan) => {
        plan.dependencies.push({
          dependency_id: "dep_bad_timing",
          task_id: "sfx_new",
          depends_on_task_id: "img_001",
          dependency_type: "requires_timing",
        });
        plan.tasks.push({
          task_id: "sfx_new",
          order: plan.tasks.length,
          task_type: "sfx_cue",
          source_segment_id: "sb_001",
          source_excerpt: "音效",
          production_intent: "测试用",
          recommended_mode: "auto",
          provider_hint: null,
          prompt_draft: null,
          parameters: {},
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        });
      },
    ],
  ])("reports %s", (errorCode, mutate) => {
    const plan = makeBaseAssetPlan();
    mutate(plan);

    const result = runValidation(plan);

    expect(result.decision).toBe("regen_once");
    expect(result.errors).toContain(errorCode);
  });

  it("downgrades low TTS coverage (above 0 but below 0.90) to warning instead of error", () => {
    // 模拟真实场景：LLM 切 chunk 时对部分原文做了语义微调，
    // 字符级匹配覆盖率低于 0.90 但 chunk 的 script_excerpt 仍能在原文中找到。
    const plan = makeBaseAssetPlan();
    // 把第二个 chunk 的 excerpt 短化（模拟 LLM 截断），制造 ~70% 的覆盖率
    plan.tts_plan.chunks[1]!.script_excerpt =
      plan.tts_plan.chunks[1]!.script_excerpt.substring(0, 5);

    const result = runValidation(plan);

    expect(result.decision).toBe("pass");
    expect(result.errors).not.toContain("asset_tts_script_coverage_missing");
    expect(
      result.warnings.some((w) => w.startsWith("asset_tts_script_coverage_low:")),
    ).toBe(true);
  });

  it("accepts TTS chunk whose only diff is half/full-width punctuation and emits drift warning", () => {
    // 真实事故场景：LLM 在切 chunk 时把全角逗号"修正"成半角逗号（或反过来），
    // 严格 indexOf 失败 → hasMissingExcerpt=true → asset_tts_script_coverage_missing
    // → 资产规划卡死。归一化软匹配应命中并降级为 drift warning。
    const plan = makeBaseAssetPlan();
    const originalExcerpt = plan.tts_plan.chunks[0]!.script_excerpt;
    // 把首个全角逗号替换为半角逗号（chunk_id 来自 baseStoryboardPlan.segments[0]）
    const driftedExcerpt = originalExcerpt.replace("，", ",");
    expect(driftedExcerpt).not.toBe(originalExcerpt);
    plan.tts_plan.chunks[0]!.script_excerpt = driftedExcerpt;

    const result = runValidation(plan);

    expect(result.errors).not.toContain("asset_tts_script_coverage_missing");
    expect(
      result.warnings.some((w) => w.startsWith("asset_tts_excerpt_drift:")),
    ).toBe(true);
  });

  it("reports repair_hints for repairable structural task gaps", () => {
    const plan = makeBaseAssetPlan();
    plan.tasks[2].prompt_draft = null;
    plan.tasks[3].risk_notes = [];
    plan.tasks[4].source_segment_id = "sb_001";
    plan.dependencies = plan.dependencies.filter(
      (dependency) => dependency.task_id !== "video_001",
    );
    delete (plan.tasks[4].parameters as Record<string, unknown>)
      .static_fallback_task_id;

    const result = runValidation(plan);

    expect(result.decision).toBe("regen_once");
    expect(result.metrics.repair_hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: "img_001",
          task_type: "image_still",
          source_segment_id: "sb_001",
          missing_fields: ["prompt_draft"],
        }),
        expect.objectContaining({
          task_id: "motion_001",
          task_type: "render_motion_cue",
          source_segment_id: "sb_001",
          missing_fields: ["risk_notes"],
        }),
        expect.objectContaining({
          task_id: "video_001",
          task_type: "video_clip",
          source_segment_id: "sb_001",
          missing_fields: ["static_fallback_task_id"],
        }),
      ]),
    );
  });

  describe("audio cue input contract", () => {
    it("warns when sfx_cue has no prompt_draft and no tag parameters", () => {
      const plan = makeBaseAssetPlan();
      plan.tasks.push({
        task_id: "sfx_bare",
        order: plan.tasks.length,
        task_type: "sfx_cue",
        source_segment_id: "sb_001",
        source_excerpt: "音效",
        production_intent: "测试用",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      });

      const result = runValidation(plan);

      expect(result.decision).toBe("pass");
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("asset_audio_cue_no_input_contract:sfx_bare")]),
      );
    });

    it("does not warn when sfx_cue has prompt_draft", () => {
      const plan = makeBaseAssetPlan();
      plan.tasks.push({
        task_id: "sfx_ok",
        order: plan.tasks.length,
        task_type: "sfx_cue",
        source_segment_id: "sb_001",
        source_excerpt: "音效",
        production_intent: "测试用",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: "低频战鼓声",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      });

      const result = runValidation(plan);

      expect(result.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining("asset_audio_cue_no_input_contract:sfx_ok")]),
      );
    });

    it("does not warn when sfx_cue has sfx_tags parameter", () => {
      const plan = makeBaseAssetPlan();
      plan.tasks.push({
        task_id: "sfx_tags",
        order: plan.tasks.length,
        task_type: "sfx_cue",
        source_segment_id: "sb_001",
        source_excerpt: "音效",
        production_intent: "测试用",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: { sfx_tags: ["drum", "impact"] },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      });

      const result = runValidation(plan);

      expect(result.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining("asset_audio_cue_no_input_contract:sfx_tags")]),
      );
    });
  });

  describe("zero video_clip explanation", () => {
    it("warns when plan has zero video_clip and only boilerplate production notes", () => {
      const plan = makeBaseAssetPlan();
      plan.tasks = plan.tasks.filter((t) => t.task_type !== "video_clip");
      plan.dependencies = plan.dependencies.filter(
        (d) => d.task_id !== "video_001" && d.depends_on_task_id !== "video_001",
      );
      plan.global_production_notes = [
        "TTS 与字幕任务由本地服务确定性创建，LLM 不输出 tts_audio 或 subtitle_track。",
      ];

      const result = runValidation(plan);

      expect(result.warnings).toContain("asset_plan_zero_video_clip_without_explanation");
    });

    it("does not warn when plan has zero video_clip but LLM provided production notes", () => {
      const plan = makeBaseAssetPlan();
      plan.tasks = plan.tasks.filter((t) => t.task_type !== "video_clip");
      plan.dependencies = plan.dependencies.filter(
        (d) => d.task_id !== "video_001" && d.depends_on_task_id !== "video_001",
      );
      plan.global_production_notes = [
        "TTS 与字幕任务由本地服务确定性创建，LLM 不输出 tts_audio 或 subtitle_track。",
        "题材偏话术对峙，全静态+运镜足够表达动作因果。",
      ];

      const result = runValidation(plan);

      expect(result.warnings).not.toContain("asset_plan_zero_video_clip_without_explanation");
    });

    it("does not warn when plan has at least one video_clip", () => {
      const plan = makeBaseAssetPlan();

      const result = runValidation(plan);

      expect(result.warnings).not.toContain("asset_plan_zero_video_clip_without_explanation");
    });
  });
});
