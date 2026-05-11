import { describe, expect, it } from "vitest";

import {
  AssetPlan,
  AssetPlanningValidationResult,
  ScriptDraftPackage,
  ScriptInputBundle,
  ScriptSemanticReviewResult,
  ScriptValidationResult,
  StoryboardPlan,
  StoryboardValidationResult,
  TopicCandidateCard,
  TopicDeliveryPack,
  TopicPackage,
} from "../../shared/src/index.js";

describe("shared schema contracts", () => {
  it("parses the topic and script shared contracts", () => {
    const candidate = TopicCandidateCard.parse({
      event_identity: "yanzi-envoy-to-chu",
      title: "晏子使楚",
      one_line_angle: "楚王不是只压晏子一次，而是连续压了三次。",
      family_label: "君臣博弈",
      scope_label: "单事件",
      estimated_duration_band: "medium",
      why_this_now: "近期未出现同 event_id，且有强冲突与强场面。",
      core_conflict: "楚王当众压场，晏子必须当场顶回去。",
      strong_scene: "楚王连续压场，晏子一句句顶回去。",
      must_cover_preview: ["入楚受辱", "橘淮之辩"],
      risk_hints: ["避免写成课堂导入"],
      source_hint: "《晏子春秋》",
      recent_usage_hint: "近期未出现同 event_id",
      viral_rubric: {
        hook_power: "high",
        novelty_gap: "medium",
        emotion_gap: "high",
        share_impulse: "high",
        visual_promise: "high",
      },
    });

    const topicPackage = TopicPackage.parse({
      topic_id: "topic-yanzi-shichu",
      title: "晏子使楚",
      selected_angle: "楚王不是只压晏子一次，而是连续压了三次。",
      family_label: "君臣博弈",
      scope_label: "单事件",
      core_conflict: "楚王当众压场，晏子必须当场顶回去。",
      strong_scene: "楚王连续压场，晏子一句句顶回去。",
      packaging_seed: "楚王连压三次，晏子一次没退。",
      stakes: "当场退让，丢掉的不只是个人体面，还有齐国场面。",
      must_include_beats: ["入楚受辱", "橘淮之辩"],
      forbidden_expansions: ["延展到后续列传"],
      risk_hints: ["避免课堂导入"],
      source_anchor_refs: ["《晏子春秋》"],
      canonical_quotes: ["橘生淮南则为橘"],
      ambiguity_notes: [],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "楚王不是只压晏子一次，而是连续压了三次。",
        pressure_escalation: "从羞辱身形升级到羞辱齐国与齐人风气。",
        mid_reveal: "晏子守住的不是口舌，而是齐国场面。",
        peak_payoff: "橘淮之辩把第三次压场原样顶回。",
        ending_residue: "这种场面，一退就不只是退掉自己。",
      },
    });

    const deliveryPack = TopicDeliveryPack.parse({
      opening_move: "question",
      opening_pressure_level: "high",
      voice_tilt: "sharper",
      pacing_tilt: "neutral",
      ending_tilt: "judgment",
      visual_tilt: ["faces", "courtroom"],
      hook_claim:
        "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
      hook_emotion: "压迫",
      reveal_position: "mid",
      caution_notes: [
        "不要把 hook 写成课堂导入",
        "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
      ],
    });

    const bundle = ScriptInputBundle.parse({
      topic_package: topicPackage,
      topic_delivery_pack: deliveryPack,
      hard_lane: {
        event_identity: "yanzi-envoy-to-chu",
        selected_angle: "楚王不是只压晏子一次，而是连续压了三次。",
        scope_label: "单事件",
        core_conflict: topicPackage.core_conflict,
        stakes: topicPackage.stakes,
        must_include_beats: ["入楚受辱", "橘淮之辩"],
        forbidden_expansions: ["延展到后续列传"],
        source_anchor_refs: topicPackage.source_anchor_refs,
        canonical_quotes: topicPackage.canonical_quotes,
        ambiguity_notes: topicPackage.ambiguity_notes,
        duration_band: "medium",
      },
      soft_lane: {
        narrative_tension_map: topicPackage.narrative_tension_map,
        strong_scene: topicPackage.strong_scene,
        voice_hint: "克制但不退",
      },
      packaging_lane: {
        hook_claim: deliveryPack.hook_claim,
        hook_emotion: deliveryPack.hook_emotion,
        reveal_position: deliveryPack.reveal_position,
        title_profile: "conflict-first",
        cover_profile: "faces-closeup",
        risk_posture: "controlled",
      },
    });

    const draftPackage = ScriptDraftPackage.parse({
      script_text: "楚王第一次压场时，晏子没有退。",
      estimated_duration_sec: 95,
      beat_trace: [
        {
          beat: "入楚受辱",
          excerpt: "楚王第一次压场时，晏子没有退。",
          confidence: 0.92,
        },
      ],
      quote_trace: [
        {
          quote: "橘生淮南则为橘",
          usage_type: "exact",
          excerpt: "橘生淮南则为橘",
        },
      ],
      opening_span:
        "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
      ending_span: "这种场面，一退就不只是退掉自己。",
    });

    const localValidation = ScriptValidationResult.parse({
      stage: "script_local_validation",
      decision: "pass",
      errors: [],
      warnings: ["duration_slightly_out_of_band"],
      metrics: {
        estimated_duration_sec: 95,
      },
    });

    const semanticReview = ScriptSemanticReviewResult.parse({
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["hook_kill_power_weak"],
      patch_targets: ["opening"],
      summary: "开头停留力偏弱，但可定点提升。",
      confidence: 0.84,
    });

    expect(candidate.viral_rubric.hook_power).toBe("high");
    expect(topicPackage.narrative_tension_map.hook_claim).toContain("连续压了三次");
    expect(deliveryPack.reveal_position).toBe("mid");
    expect(bundle.packaging_lane.hook_claim).toBe(deliveryPack.hook_claim);
    expect(draftPackage.beat_trace).toHaveLength(1);
    expect(localValidation.stage).toBe("script_local_validation");
    expect(semanticReview.patch_intent).toBe("lift");
  });

  it("restricts viral rubric and reveal position enum values", () => {
    expect(() =>
      TopicCandidateCard.parse({
        event_identity: "test",
        title: "test",
        one_line_angle: "angle",
        family_label: "family",
        scope_label: "scope",
        estimated_duration_band: "medium",
        why_this_now: "now",
        core_conflict: "conflict",
        strong_scene: "scene",
        must_cover_preview: [],
        risk_hints: [],
        source_hint: "source",
        recent_usage_hint: "recent",
        viral_rubric: {
          hook_power: "extreme",
          novelty_gap: "medium",
          emotion_gap: "high",
          share_impulse: "high",
          visual_promise: "high",
        },
      }),
    ).toThrow();

    expect(() =>
      TopicDeliveryPack.parse({
        opening_move: "question",
        opening_pressure_level: "high",
        voice_tilt: "sharper",
        pacing_tilt: "neutral",
        ending_tilt: "judgment",
        visual_tilt: ["faces"],
        hook_claim: "claim",
        hook_emotion: "压迫",
        reveal_position: "finale",
        caution_notes: [],
      }),
    ).toThrow();
  });

  it("models ScriptValidationResult as a discriminated union", () => {
    expect(() =>
      ScriptValidationResult.parse({
        stage: "script_local_validation",
        decision: "pass",
        patch_intent: "lift",
        errors: [],
        warnings: [],
        metrics: {},
      }),
    ).toThrow();

    expect(() =>
      ScriptValidationResult.parse({
        stage: "script_semantic_review",
        decision: "pass",
        hard_issues: [],
        soft_issues: [],
        patch_targets: [],
        summary: "ok",
        confidence: 0.9,
      }),
    ).toThrow();

    const skippedSemanticReview = ScriptValidationResult.parse({
      stage: "script_semantic_review",
      decision: "skipped",
      patch_intent: null,
      hard_issues: [],
      soft_issues: [],
      patch_targets: [],
      summary: "本地硬校验未通过，未进入语义审校。",
      confidence: 0.5,
    });

    expect(skippedSemanticReview.decision).toBe("skipped");
  });

  it("parses the storyboard shared contracts", () => {
    const plan = StoryboardPlan.parse({
      plan_version: "storyboard_v1",
      source_script_record_id: "scr_001",
      source_topic_package_id: "topic_001",
      estimated_total_duration_sec: 90,
      segments: [
        {
          segment_id: "sb_001",
          order: 0,
          script_excerpt: "楚王第一次压场时，晏子没有退。",
          start_hint_sec: 0,
          end_hint_sec: 9,
          narrative_role: "opening",
          visual_intent: "让观众先看见公开压场的压力。",
          scene_description: "宫廷中众人注视，晏子站在楚王面前。",
          visual_elements: ["楚王", "晏子", "宫廷"],
          framing_hint: "wide",
          content_type: "live_action",
          motion_hint: "push_in",
          editing_hint: "single",
          on_screen_text: ["第一次压场"],
          linked_beats: ["入楚受辱"],
          linked_quotes: [],
          risk_notes: [],
        },
      ],
      global_visual_notes: [],
    });

    const validation = StoryboardValidationResult.parse({
      stage: "storyboard_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {
        segment_count: 1,
      },
    });

    expect(plan.plan_version).toBe("storyboard_v1");
    expect(validation.stage).toBe("storyboard_local_validation");
  });

  it("parses the asset planning shared contracts", () => {
    const plan = AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_record_1",
      source_script_record_id: "script_record_1",
      source_topic_package_id: "topic_package_1",
      art_bible: {
        era_style: "战国宫廷与军帐，青铜器、木构建筑、布帛服饰",
        visual_tone: "冷色压迫，关键转折处用暖光突出人物反应",
        characters: [
          {
            character_id: "char_yanzi",
            label: "晏子",
            role: "齐国使节",
            visual_description: "身形矮小但站姿挺直，深色齐国朝服，神情沉稳",
            consistency_notes: ["所有涉及晏子的任务复用该人物描述"],
          },
        ],
        locations: [
          {
            location_id: "loc_chu_palace",
            label: "楚国大殿",
            visual_description: "高台、木梁、青铜灯具，压迫感强",
            consistency_notes: ["大殿镜头保持同一空间气质"],
          },
        ],
        props: [
          {
            prop_id: "prop_gate",
            label: "狗洞",
            visual_description: "城墙根部低矮阴暗的木栅洞口",
            consistency_notes: [],
          },
        ],
        global_prompt_prefix:
          "古代中国历史短视频画面，战国质感，电影感构图",
        global_negative_prompts: ["现代建筑", "现代服饰", "过度血腥"],
        consistency_notes: [
          "人物、场景、道具描述应在所有视觉任务中复用",
        ],
      },
      tts_plan: {
        voice_profile_id: "voice_default_male_storyteller",
        estimated_total_duration_sec: 85,
        chunking_strategy: "sentence_boundary",
        chunks: [
          {
            chunk_id: "tts_001",
            order: 0,
            script_excerpt: "楚王把齐国使节逼到狗洞前。",
            estimated_duration_sec: 5,
          },
        ],
      },
      tasks: [
        {
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio",
          source_segment_id: null,
          source_excerpt: "楚王把齐国使节逼到狗洞前。",
          production_intent: "生成口播音频切片",
          recommended_mode: "auto",
          provider_hint: "default_tts",
          prompt_draft: null,
          parameters: {
            chunk_id: "tts_001",
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
          source_excerpt: "楚王把齐国使节逼到狗洞前。",
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
          source_excerpt: "楚王把齐国使节逼到狗洞前。",
          production_intent: "表现狗洞羞辱的压迫感",
          recommended_mode: "manual_allowed",
          provider_hint: "wanx",
          prompt_draft:
            "古代中国历史短视频画面，楚国城墙根部低矮狗洞，齐国使节站在阴影前",
          parameters: {
            aspect_ratio: "9:16",
            count: 1,
          },
          manual_upload_policy: {
            allowed: true,
            required: false,
            accepted_file_types: ["image/png", "image/jpeg"],
            acceptance_notes: ["必须能对应本段 script_excerpt"],
          },
          risk_notes: ["避免现代建筑和现代服饰"],
          cost_tier: "low",
          initial_status: "planned",
        },
        {
          task_id: "motion_001",
          order: 3,
          task_type: "render_motion_cue",
          source_segment_id: "sb_001",
          source_excerpt: "楚王把齐国使节逼到狗洞前。",
          production_intent: "对静态图做轻微推进",
          recommended_mode: "auto",
          provider_hint: null,
          prompt_draft: null,
          parameters: {
            motion: "push_in",
            fallback_for_task_id: "video_001",
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
      ],
      cost_summary: {
        total_tasks: 4,
        by_type: {
          tts_audio: 1,
          subtitle_track: 1,
          image_still: 1,
          render_motion_cue: 1,
        },
        by_cost_tier: {
          free: 2,
          low: 2,
          medium: 0,
          high: 0,
        },
        estimated_provider_calls: 2,
        notes: [
          "TTS 与字幕任务由本地服务确定性创建；默认以静态图加低成本运镜为主",
        ],
      },
      global_production_notes: ["不生成物理文件，只生成任务合同"],
    });

    const validation = AssetPlanningValidationResult.parse({
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 4,
        dependency_count: 2,
      },
    });

    expect(plan.plan_version).toBe("asset_plan_v1");
    expect(validation.stage).toBe("asset_planning_local_validation");
  });

  it("rejects invalid asset planning enums and empty required prompt drafts", () => {
    expect(() =>
      AssetPlan.parse({
        plan_version: "asset_plan_v1",
        source_storyboard_record_id: "storyboard_record_1",
        source_script_record_id: "script_record_1",
        source_topic_package_id: "topic_package_1",
        art_bible: {
          era_style: "战国",
          visual_tone: "冷色压迫",
          characters: [],
          locations: [],
          props: [],
          global_prompt_prefix: "历史短视频",
          global_negative_prompts: [],
          consistency_notes: [],
        },
        tts_plan: {
          voice_profile_id: "voice_1",
          estimated_total_duration_sec: 85,
          chunking_strategy: "sentence_boundary",
          chunks: [],
        },
        tasks: [
          {
            task_id: "img_001",
            order: 0,
            task_type: "image_still",
            source_segment_id: "sb_001",
            source_excerpt: "楚王把齐国使节逼到狗洞前。",
            production_intent: "表现压迫",
            recommended_mode: "auto",
            provider_hint: "wanx",
            prompt_draft: "",
            parameters: {},
            manual_upload_policy: {
              allowed: true,
              required: false,
              accepted_file_types: ["image/png"],
              acceptance_notes: [],
            },
            risk_notes: [],
            cost_tier: "expensive",
            initial_status: "planned",
          },
        ],
        dependencies: [],
        cost_summary: {
          total_tasks: 1,
          by_type: {},
          by_cost_tier: {},
          estimated_provider_calls: 1,
          notes: [],
        },
        global_production_notes: [],
      }),
    ).toThrow();
  });

  it("rejects invalid storyboard timing and enum values", () => {
    const validSegment = {
      segment_id: "sb_001",
      order: 0,
      script_excerpt: "楚王第一次压场时，晏子没有退。",
      start_hint_sec: 10,
      end_hint_sec: 20,
      narrative_role: "opening",
      visual_intent: "让观众先看见公开压场的压力。",
      scene_description: "宫廷中众人注视，晏子站在楚王面前。",
      visual_elements: ["楚王", "晏子", "宫廷"],
      framing_hint: "wide",
      content_type: "live_action",
      motion_hint: "push_in",
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: ["入楚受辱"],
      linked_quotes: [],
      risk_notes: [],
    };
    const validPlan = {
      plan_version: "storyboard_v1",
      source_script_record_id: "scr_001",
      source_topic_package_id: "topic_001",
      estimated_total_duration_sec: 90,
      segments: [validSegment],
      global_visual_notes: [],
    };

    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, end_hint_sec: 10 }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, narrative_role: "recap" }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, framing_hint: "drone" }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, content_type: "asset_task" }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, motion_hint: "orbit" }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardPlan.parse({
        ...validPlan,
        segments: [{ ...validSegment, editing_hint: "timeline" }],
      }),
    ).toThrow();
    expect(() =>
      StoryboardValidationResult.parse({
        stage: "script_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      }),
    ).toThrow();
  });
});
