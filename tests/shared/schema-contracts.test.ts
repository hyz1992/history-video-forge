import { describe, expect, it } from "vitest";

import {
  AssetManifest,
  AssetPlan,
  AssetPlanningValidationResult,
  AssetsValidationResult,
  ComposeTimeline,
  ComposeValidationResult,
  ExportArtifact,
  MediaLibraryItem,
  RenderValidationResult,
  ScriptDraftPackage,
  ScriptInputBundle,
  ScriptSemanticReviewResult,
  ScriptValidationResult,
  StoryboardPlan,
  StoryboardValidationResult,
  TopicCandidateCard,
  TopicDeliveryPack,
  TopicPackage,
  VoiceIntent,
  VoiceMatchResult,
  VoiceProfile,
} from "../../shared/src/index.js";

describe("shared schema contracts", () => {
  it("parses shared voice intent, profile, and match result contracts", () => {
    const intent = VoiceIntent.parse({
      content_family: "historical_power",
      narrator_persona: "冷静旁白",
      desired_traits: ["cold", "authoritative", "restrained"],
      avoid_traits: ["shouting", "broadcast_exaggeration"],
      gender_tone: "male_leaning",
      age_band: "35-45",
      pitch: "mid_low",
      pace: "medium_slow",
      energy: 0.45,
      authority: 0.9,
      suspense: 0.7,
      warmth: 0.2,
      style_notes: ["短停顿", "重音明确"],
    });

    expect(intent.content_family).toBe("historical_power");

    const profile = VoiceProfile.parse({
      voice_profile_id: "voice_cold_authority",
      kind: "preset",
      name: "冷峻权谋型",
      description: "冷静、有压迫感的历史权谋旁白",
      design_prompt:
        "35 到 45 岁偏男中低音，声线收紧，低沉克制，重音明确，停顿短促，情绪冷静而有压迫感，适合权谋、战争、内幕和高风险叙事。避免怒吼、恐吓腔、舞台表演感和过重气泡音。",
      preview_text: "诏令还没出宫门，刀兵就先到了阶下。",
      provider_name: "dashscope",
      provider_voice_id: null,
      provider_status: "missing",
      target_model: "qwen3-tts-vd-2026-01-26",
      recommended_content_families: ["historical_power", "war"],
      voice_traits: ["cold", "authoritative", "restrained"],
      avoid_traits: ["shouting", "stage_acting"],
      gender_tone: "male_leaning",
      age_band: "35-45",
      pitch: "mid_low",
      pace: "medium_slow",
      energy: 0.45,
      authority: 0.9,
      suspense: 0.7,
      warmth: 0.2,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    });

    expect(profile.provider_status).toBe("missing");

    const match = VoiceMatchResult.parse({
      selected_voice_profile_id: "voice_cold_authority",
      match_score: 0.91,
      match_decision: "matched_existing",
      match_reasons: [
        "content_family:historical_power",
        "traits:cold,authoritative",
      ],
      rejected_profile_ids: [
        {
          voice_profile_id: "voice_crisp_storyteller",
          reason: "trait_mismatch",
        },
      ],
    });

    expect(match.match_decision).toBe("matched_existing");
  });

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

  it("provides default source_mode=recommended and null source_ref when omitted", () => {
    const pkg = TopicPackage.parse({
      topic_id: "topic-default-mode",
      title: "默认来源模式",
      selected_angle: "测试角度",
      family_label: "测试",
      scope_label: "单事件",
      core_conflict: "核心冲突",
      strong_scene: "强场面",
      packaging_seed: "包装种子",
      stakes: "赌注",
      must_include_beats: ["节拍1"],
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["测试来源"],
      canonical_quotes: [],
      ambiguity_notes: [],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "hook",
        pressure_escalation: "pressure",
        mid_reveal: "reveal",
        peak_payoff: "payoff",
        ending_residue: "residue",
      },
    });

    expect(pkg.source_mode).toBe("recommended");
    expect(pkg.source_ref).toBeNull();
  });

  it("accepts all three valid source_mode enum values", () => {
    const base = {
      topic_id: "topic-mode-enum",
      title: "来源枚举",
      selected_angle: "角度",
      family_label: "类型",
      scope_label: "单事件",
      core_conflict: "冲突",
      strong_scene: "场面",
      packaging_seed: "种子",
      stakes: "赌注",
      must_include_beats: ["节拍1"],
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["来源"],
      canonical_quotes: [],
      ambiguity_notes: [],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "h",
        pressure_escalation: "p",
        mid_reveal: "m",
        peak_payoff: "pp",
        ending_residue: "e",
      },
    };

    expect(TopicPackage.parse({ ...base, source_mode: "recommended" }).source_mode)
      .toBe("recommended");
    expect(TopicPackage.parse({ ...base, source_mode: "library" }).source_mode)
      .toBe("library");
    expect(TopicPackage.parse({ ...base, source_mode: "custom" }).source_mode)
      .toBe("custom");
  });

  it("rejects invalid source_mode values", () => {
    const base = {
      topic_id: "topic-bad-mode",
      title: "非法来源",
      selected_angle: "角度",
      family_label: "类型",
      scope_label: "单事件",
      core_conflict: "冲突",
      strong_scene: "场面",
      packaging_seed: "种子",
      stakes: "赌注",
      must_include_beats: ["节拍1"],
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["来源"],
      canonical_quotes: [],
      ambiguity_notes: [],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "h",
        pressure_escalation: "p",
        mid_reveal: "m",
        peak_payoff: "pp",
        ending_residue: "e",
      },
    };

    expect(() => TopicPackage.parse({ ...base, source_mode: "external" })).toThrow();
    expect(() => TopicPackage.parse({ ...base, source_mode: "" })).toThrow();
  });

  it("hard_lane 和 soft_lane 不包含 source_mode / source_ref", () => {
    // hard_lane 是 ScriptInputBundle 的 strict 子 schema，不应扩展 source 元数据
    const topicPackage = TopicPackage.parse({
      topic_id: "topic-no-leak",
      title: "不泄露",
      selected_angle: "角度",
      family_label: "类型",
      scope_label: "单事件",
      core_conflict: "冲突",
      strong_scene: "场面",
      packaging_seed: "种子",
      stakes: "赌注",
      must_include_beats: ["节拍1"],
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["来源"],
      canonical_quotes: [],
      ambiguity_notes: [],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "h",
        pressure_escalation: "p",
        mid_reveal: "m",
        peak_payoff: "pp",
        ending_residue: "e",
      },
    });

    // ScriptInputBundle 能解析带 source_mode/source_ref 的 topic_package
    const bundle = ScriptInputBundle.parse({
      topic_package: topicPackage,
      topic_delivery_pack: {
        opening_move: "question",
        opening_pressure_level: "high",
        voice_tilt: "sharper",
        pacing_tilt: "neutral",
        ending_tilt: "judgment",
        visual_tilt: ["faces"],
        hook_claim: "hook",
        hook_emotion: "压迫",
        reveal_position: "mid",
        caution_notes: [],
      },
      hard_lane: {
        event_identity: "test",
        selected_angle: "角度",
        scope_label: "单事件",
        core_conflict: "冲突",
        stakes: "赌注",
        must_include_beats: ["节拍1"],
        forbidden_expansions: [],
        source_anchor_refs: ["来源"],
        canonical_quotes: [],
        ambiguity_notes: [],
        duration_band: "medium",
      },
      soft_lane: {
        narrative_tension_map: topicPackage.narrative_tension_map,
        strong_scene: "场面",
        voice_hint: "克制",
      },
      packaging_lane: {
        hook_claim: "hook",
        hook_emotion: "压迫",
        reveal_position: "mid",
        title_profile: "conflict-first",
        cover_profile: "faces-closeup",
        risk_posture: "controlled",
      },
    });

    expect(bundle.topic_package.source_mode).toBe("recommended");
    // hard_lane 和 soft_lane 是 strict schema，source_mode/source_ref 不应出现在其中
    const hardKeys = Object.keys(bundle.hard_lane);
    expect(hardKeys).not.toContain("source_mode");
    expect(hardKeys).not.toContain("source_ref");
    const softKeys = Object.keys(bundle.soft_lane);
    expect(softKeys).not.toContain("source_mode");
    expect(softKeys).not.toContain("source_ref");
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

  it("parses asset plan with new global strategy fields", () => {
    const plan = AssetPlan.parse({
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
      visual_budget: { default_path: "image_still_plus_render_motion_cue", video_clip_policy: "conservative" },
      downgrade_policy: { video_to_still_fallback: true },
      global_audio_strategy: { bgm_cue_policy: "minimal" },
      tts_plan: {
        voice_profile_id: "voice_1",
        estimated_total_duration_sec: 85,
        chunking_strategy: "sentence_boundary",
        chunks: [],
      },
      tasks: [
        {
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio",
          source_segment_id: null,
          source_excerpt: "全片口播",
          production_intent: "TTS",
          recommended_mode: "auto",
          provider_hint: null,
          prompt_draft: null,
          parameters: {},
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
      ],
      dependencies: [],
      cost_summary: { total_tasks: 1, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 1, notes: [] },
      global_production_notes: [],
    });

    expect(plan.visual_budget).toEqual({ default_path: "image_still_plus_render_motion_cue", video_clip_policy: "conservative" });
    expect(plan.downgrade_policy).toEqual({ video_to_still_fallback: true });
    expect(plan.global_audio_strategy).toEqual({ bgm_cue_policy: "minimal" });
  });

  it("provides defaults for new global strategy fields when omitted", () => {
    const plan = AssetPlan.parse({
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
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio",
          source_segment_id: null,
          source_excerpt: "全片口播",
          production_intent: "TTS",
          recommended_mode: "auto",
          provider_hint: null,
          prompt_draft: null,
          parameters: {},
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
      ],
      dependencies: [],
      cost_summary: { total_tasks: 1, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 1, notes: [] },
      global_production_notes: [],
    });

    expect(plan.visual_budget).toEqual({});
    expect(plan.downgrade_policy).toEqual({});
    expect(plan.global_audio_strategy).toEqual({});
  });

  it("fills defaults for manual_upload_policy subfields when LLM omits them", () => {
    // 回归用例：LLM 在多 chunk 规划时系统性漏写 manual_upload_policy 的子字段
    // （required / accepted_file_types / acceptance_notes），导致
    // asset_chunk_plan_schema_invalid 失败。修复后 schema 自动补默认值。
    const baseTask = {
      task_id: "tts_001",
      order: 0,
      task_type: "tts_audio" as const,
      source_segment_id: null,
      source_excerpt: "全片口播",
      production_intent: "TTS",
      recommended_mode: "auto" as const,
      provider_hint: null,
      prompt_draft: null,
      parameters: {},
      risk_notes: [],
      cost_tier: "low" as const,
      initial_status: "planned" as const,
    };

    // 1. manual_upload_policy 完全缺失 → 整个对象补默认
    const plan1 = AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "sr1",
      source_script_record_id: "sc1",
      source_topic_package_id: "tp1",
      art_bible: {
        era_style: "战国",
        visual_tone: "冷色",
        characters: [],
        locations: [],
        props: [],
        global_prompt_prefix: "x",
        global_negative_prompts: [],
        consistency_notes: [],
      },
      tts_plan: {
        voice_profile_id: "v1",
        estimated_total_duration_sec: 85,
        chunking_strategy: "sentence_boundary",
        chunks: [],
      },
      tasks: [{ ...baseTask }],
      dependencies: [],
      cost_summary: { total_tasks: 1, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 1, notes: [] },
      global_production_notes: [],
    });
    expect(plan1.tasks[0]!.manual_upload_policy).toEqual({
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    });

    // 2. manual_upload_policy 只有 allowed，缺其余子字段 → 子字段各自补默认
    const plan2 = AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "sr1",
      source_script_record_id: "sc1",
      source_topic_package_id: "tp1",
      art_bible: {
        era_style: "战国",
        visual_tone: "冷色",
        characters: [],
        locations: [],
        props: [],
        global_prompt_prefix: "x",
        global_negative_prompts: [],
        consistency_notes: [],
      },
      tts_plan: {
        voice_profile_id: "v1",
        estimated_total_duration_sec: 85,
        chunking_strategy: "sentence_boundary",
        chunks: [],
      },
      tasks: [{ ...baseTask, manual_upload_policy: { allowed: true } }],
      dependencies: [],
      cost_summary: { total_tasks: 1, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 1, notes: [] },
      global_production_notes: [],
    });
    expect(plan2.tasks[0]!.manual_upload_policy).toEqual({
      allowed: true,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    });
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

  it("parses a minimal AssetManifest with tts execution, artifact, segment route, and blocked readiness", () => {
    const manifest = AssetManifest.parse({
      manifest_version: "asset_manifest_v1",
      source_asset_plan_id: "plan_001",
      source_storyboard_record_id: "storyboard_001",
      source_script_record_id: "script_001",
      execution_options: {
        execution_mode: "auto_available",
        voice_profile_id: "voice_1",
        enabled_provider_types: ["tts", "image"],
        allow_manual_placeholders: true,
      },
      executions: [
        {
          execution_id: "exec_tts_001",
          task_id: "tts_001",
          task_type: "tts_audio",
          status: "completed",
          origin: "provider",
          started_at: "2025-01-01T00:00:00Z",
          completed_at: "2025-01-01T00:00:05Z",
          provider_id: "default_tts",
          attempts: 1,
          output_artifact_ids: ["art_tts_001"],
          notes: [],
        },
      ],
      artifacts: [
        {
          artifact_id: "art_tts_001",
          artifact_type: "tts_chunk_audio",
          origin: "provider",
          file_uri: "memory://tts_chunk.wav",
          created_at: "2025-01-01T00:00:05Z",
          metadata: {
            duration_sec: 5.0,
            voice_profile_id: "voice_1",
            provider_voice_id: "voice-provider-001",
            voice_profile_match_score: 0.91,
            voice_profile_match_reasons: ["matched existing preset"],
            timing_source: "estimated",
            sample_rate: 24000,
            format: "wav",
            tts_chunk_id: "tts_chunk_001",
            segment_ids: ["sb_001"],
            script_excerpt: "楚王第一次压场时，晏子没有退。",
          },
        },
        {
          artifact_id: "art_tts_merged_001",
          artifact_type: "tts_merged_audio",
          origin: "provider",
          file_uri: "memory://tts_merged.wav",
          created_at: "2025-01-01T00:00:05Z",
          metadata: {
            duration_sec: 85.0,
            voice_profile_id: "voice_1",
            provider_voice_id: "voice-provider-001",
            voice_profile_match_score: 0.91,
            voice_profile_match_reasons: ["matched existing preset"],
            timing_source: "estimated",
            sample_rate: 24000,
            format: "wav",
            chunk_artifact_ids: ["art_tts_001"],
          },
        },
      ],
      audio_summary: {
        voice_profile_id: "voice_1",
        tts_total_duration_sec: 85.0,
        tts_chunk_artifact_ids: ["art_tts_001"],
        tts_chunk_routes: [
          {
            tts_chunk_id: "tts_chunk_001",
            artifact_id: "art_tts_001",
            segment_ids: ["sb_001"],
            script_excerpt: "楚王第一次压场时，晏子没有退。",
          },
        ],
        tts_merged_artifact_id: "art_tts_merged_001",
        subtitle_artifact_id: null,
        bgm_placements: [],
        sfx_artifact_ids: [],
      },
      segment_routes: [
        {
          segment_id: "sb_001",
          tts_artifact_id: "art_tts_001",
          subtitle_artifact_id: null,
          primary_visual_artifact_id: null,
          visual_route_type: "missing",
          motion_artifact_id: null,
          fallback_visual_artifact_id: null,
          sfx_artifact_ids: [],
          bgm_placement_ids: [],
          readiness: "blocked",
          notes: ["视觉资产未就绪"],
        },
      ],
      readiness: "blocked",
      notes: [],
    });

    expect(manifest.manifest_version).toBe("asset_manifest_v1");
    expect(manifest.executions).toHaveLength(1);
    expect(manifest.artifacts).toHaveLength(2);
    expect(manifest.segment_routes).toHaveLength(1);
    expect(manifest.readiness).toBe("blocked");
    expect(manifest.segment_routes[0].visual_route_type).toBe("missing");
  });

  it("accepts BGM placements with source task identity", () => {
    const manifest = AssetManifest.parse({
      manifest_version: "asset_manifest_v1",
      source_asset_plan_id: "plan_001",
      source_storyboard_record_id: "storyboard_001",
      source_script_record_id: "script_001",
      execution_options: {
        execution_mode: "auto_available",
        voice_profile_id: "voice_1",
        enabled_provider_types: ["bgm"],
        allow_manual_placeholders: true,
      },
      executions: [],
      artifacts: [],
      audio_summary: {
        voice_profile_id: "voice_1",
        tts_total_duration_sec: null,
        tts_chunk_artifact_ids: [],
        tts_chunk_routes: [],
        tts_merged_artifact_id: null,
        subtitle_artifact_id: null,
        bgm_placements: [
          {
            bgm_placement_id: "bgm_place_001",
            source_task_id: "bgm_task_001",
            scope: "global",
            artifact_id: null,
            start_policy: "timeline_start",
            end_policy: "timeline_end",
            segment_ids: [],
            volume: 0.3,
            fade_in_sec: 0,
            fade_out_sec: 0,
          },
        ],
        sfx_artifact_ids: [],
      },
      segment_routes: [],
      readiness: "blocked",
      notes: [],
    });

    expect(manifest.audio_summary.bgm_placements[0]?.source_task_id).toBe(
      "bgm_task_001",
    );
  });

  it("parses AssetsValidationResult with stage assets_local_validation", () => {
    const result = AssetsValidationResult.parse({
      stage: "assets_local_validation",
      decision: "blocked",
      errors: ["segment sb_002 missing tts artifact"],
      warnings: ["no bgm configured"],
      metrics: { total_segments: 3, ready_segments: 2 },
    });

    expect(result.stage).toBe("assets_local_validation");
    expect(result.decision).toBe("blocked");
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("accepts a minimal compose timeline", () => {
    const result = ComposeTimeline.safeParse({
      timeline_version: "compose_timeline_v1",
      source_asset_manifest_record_id: "asset_manifest_001",
      source_asset_plan_record_id: "asset_plan_001",
      source_storyboard_record_id: "storyboard_001",
      source_script_record_id: "script_001",
      output_profile: {
        aspect_ratio: "9:16",
        width: 1080,
        height: 1920,
        fps: 30,
      },
      duration_sec: 12,
      tracks: [
        {
          track_id: "track_visual",
          track_type: "visual",
          clips: [
            {
              clip_id: "clip_visual_sb_001",
              segment_id: "sb_001",
              artifact_id: "artifact_img_001",
              start_sec: 0,
              duration_sec: 12,
              clip_kind: "image_with_motion",
              motion_artifact_id: "artifact_motion_001",
              notes: [],
            },
          ],
        },
        {
          track_id: "track_narration",
          track_type: "narration",
          clips: [
            {
              clip_id: "clip_narration",
              segment_id: null,
              artifact_id: "artifact_tts_merged",
              start_sec: 0,
              duration_sec: 12,
              clip_kind: "audio",
              motion_artifact_id: null,
              notes: [],
            },
          ],
        },
      ],
      segments: [
        {
          segment_id: "sb_001",
          start_sec: 0,
          duration_sec: 12,
          visual_clip_ids: ["clip_visual_sb_001"],
          narration_clip_ids: ["clip_narration"],
          subtitle_clip_ids: [],
          notes: [],
        },
      ],
      readiness: "ready_for_render",
      notes: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects compose timelines with invalid clip timing", () => {
    const result = ComposeTimeline.safeParse({
      timeline_version: "compose_timeline_v1",
      source_asset_manifest_record_id: "asset_manifest_001",
      source_asset_plan_record_id: "asset_plan_001",
      source_storyboard_record_id: "storyboard_001",
      source_script_record_id: "script_001",
      output_profile: {
        aspect_ratio: "9:16",
        width: 1080,
        height: 1920,
        fps: 30,
      },
      duration_sec: 12,
      tracks: [
        {
          track_id: "track_visual",
          track_type: "visual",
          clips: [
            {
              clip_id: "clip_bad",
              segment_id: "sb_001",
              artifact_id: "artifact_img_001",
              start_sec: -1,
              duration_sec: 12,
              clip_kind: "image_only",
              motion_artifact_id: null,
              notes: [],
            },
          ],
        },
      ],
      segments: [],
      readiness: "blocked",
      notes: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a compose validation result", () => {
    const result = ComposeValidationResult.safeParse({
      stage: "compose_local_validation",
      decision: "ready_for_render",
      errors: [],
      warnings: [],
      metrics: {
        track_count: 2,
        clip_count: 2,
        segment_count: 1,
        duration_sec: 12,
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a rendered video export artifact", () => {
    const result = ExportArtifact.safeParse({
      artifact_id: "render_export_001",
      artifact_type: "rendered_video",
      file_uri: "file://storage/projects/proj_001/renders/render_001/output.mp4",
      mime_type: "video/mp4",
      duration_sec: 12,
      width: 1080,
      height: 1920,
      fps: 30,
      source_compose_record_id: "compose_001",
      source_asset_manifest_record_id: "asset_manifest_001",
      metadata: { renderer: "fake" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a render validation result", () => {
    const result = RenderValidationResult.safeParse({
      stage: "render_local_validation",
      decision: "rendered",
      errors: [],
      warnings: [],
      metrics: {
        duration_sec: 12,
        width: 1080,
        height: 1920,
        fps: 30,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown execution status in AssetManifest", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [
          {
            execution_id: "exec_001",
            task_id: "tts_001",
            task_type: "tts_audio",
            status: "unknown_status",
            origin: "provider",
            started_at: "2025-01-01T00:00:00Z",
            completed_at: null,
            provider_id: "default_tts",
            attempts: 1,
            output_artifact_ids: [],
            notes: [],
          },
        ],
        artifacts: [],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects artifact with empty artifact_id", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [
          {
            artifact_id: "",
            artifact_type: "tts_chunk_audio",
            origin: "provider",
            file_uri: "memory://test.wav",
            created_at: "2025-01-01T00:00:00Z",
            metadata: {
              duration_sec: 5.0,
              voice_profile_id: "voice_1",
              tts_chunk_id: "chunk_001",
              segment_ids: ["sb_001"],
              script_excerpt: "测试",
            },
          },
        ],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects segment route with invalid visual_route_type", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [
          {
            segment_id: "sb_001",
            tts_artifact_id: null,
            subtitle_artifact_id: null,
            primary_visual_artifact_id: null,
            visual_route_type: "3d_render",
            motion_artifact_id: null,
            fallback_visual_artifact_id: null,
            sfx_artifact_ids: [],
            bgm_placement_ids: [],
            readiness: "blocked",
            notes: [],
          },
        ],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects missing required metadata on tts_chunk_audio artifact", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [
          {
            artifact_id: "art_001",
            artifact_type: "tts_chunk_audio",
            origin: "provider",
            file_uri: "memory://test.wav",
            created_at: "2025-01-01T00:00:00Z",
            metadata: {
              // missing duration_sec, voice_profile_id, tts_chunk_id, segment_ids, script_excerpt
            },
          },
        ],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects missing required metadata on image artifact", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [
          {
            artifact_id: "art_001",
            artifact_type: "image",
            origin: "provider",
            file_uri: "memory://test.png",
            created_at: "2025-01-01T00:00:00Z",
            metadata: {
              // missing width, height
            },
          },
        ],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects missing required metadata on video artifact", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["tts"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [
          {
            artifact_id: "art_001",
            artifact_type: "video",
            origin: "provider",
            file_uri: "memory://test.mp4",
            created_at: "2025-01-01T00:00:00Z",
            metadata: {
              // missing duration_sec, width, height, fps
            },
          },
        ],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects invalid enabled_provider_types value", () => {
    expect(() =>
      AssetManifest.parse({
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: "plan_001",
        source_storyboard_record_id: "storyboard_001",
        source_script_record_id: "script_001",
        execution_options: {
          execution_mode: "auto_available",
          voice_profile_id: null,
          enabled_provider_types: ["ttss"],
          allow_manual_placeholders: false,
        },
        executions: [],
        artifacts: [],
        audio_summary: {
          voice_profile_id: "voice_1",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
        segment_routes: [],
        readiness: "blocked",
        notes: [],
      }),
    ).toThrow();
  });

  it("accepts approved media library items with traceable license metadata", () => {
    const result = MediaLibraryItem.safeParse({
      library_item_id: "bgm_001",
      type: "bgm",
      file_uri: "library://bgm/drum-loop.wav",
      mime_type: "audio/wav",
      duration_sec: 12.5,
      loopable: true,
      tags: ["war", "drum"],
      mood_tags: ["tense"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
        source_url: "https://example.test/source",
      },
      file_hash: "sha256:abc",
      imported_at: "2026-05-16T00:00:00.000Z",
      approved_for_use: true,
    });

    expect(result.success).toBe(true);
  });

  it("rejects media library items that are approved without commercial permission", () => {
    const result = MediaLibraryItem.safeParse({
      library_item_id: "sfx_bad",
      type: "sfx",
      file_uri: "library://sfx/bad.wav",
      mime_type: "audio/wav",
      duration_sec: 1,
      loopable: false,
      tags: [],
      mood_tags: [],
      license: {
        license_type: "unknown",
        commercial_use_allowed: false,
        attribution_required: false,
      },
      file_hash: "sha256:bad",
      imported_at: "2026-05-16T00:00:00.000Z",
      approved_for_use: true,
    });

    expect(result.success).toBe(false);
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
