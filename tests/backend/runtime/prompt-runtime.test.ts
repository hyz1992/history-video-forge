import { describe, expect, it, vi } from "vitest";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { renderLlmInteractionMarkdown } from "../../../backend/src/runtime/llm/interaction-log.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../../backend/src/runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import {
  SEGMENT_INTENT_PLANNER_OUTPUT_SCHEMA,
  SEGMENT_INTENT_REPAIR_OUTPUT_SCHEMA,
} from "../../../backend/src/modules/asset-planning/segment-intent-prompt-input.js";
import {
  SegmentAssetIntentBatchDraft,
  SegmentIntentRepairPatch,
} from "../../../backend/src/modules/asset-planning/segment-asset-intent.js";

describe("prompt runtime", () => {
  it("loads segment intent prompts with exact strict registry contracts", () => {
    const registry = createPromptRegistry();
    const planner = registry.getPrompt("asset-planning.segment-intent-planner");
    const repair = registry.getPrompt("asset-planning.segment-intent-repair");

    expect(planner.metadata).toMatchObject({
      id: "asset-planning.segment-intent-planner",
      version: "v1.0.0",
      stage: "asset_planning",
      language: "zh-CN",
      consumes: ["SegmentIntentPlannerInput"],
      produces: ["SegmentAssetIntentBatchDraft"],
      status: "active",
    });
    expect(repair.metadata).toMatchObject({
      id: "asset-planning.segment-intent-repair",
      version: "v1.0.0",
      stage: "asset_planning",
      language: "zh-CN",
      consumes: ["SegmentIntentRepairInput"],
      produces: ["SegmentIntentRepairPatch"],
      status: "active",
    });
    expect(planner.body).toContain("严格 `SegmentAssetIntentBatchDraft`");
    expect(planner.body).toContain("每个分段精确一次");
    expect(planner.body).toContain("visual_strategy_preference");
    expect(planner.body).toContain(
      "`visual_strategy_preference` 为 `null` 时，默认输出一个 `image_still` 锚点图和一个 `render_motion_cue`",
    );
    expect(planner.body).toContain(
      "只有 `why_static_insufficient` 非空时才允许额外输出 `video_clip`",
    );
    expect(planner.body).toContain(
      "`api_video` 必须输出一个 `image_still` 锚点图和一个 `video_clip`",
    );
    expect(planner.body).toContain(
      "`remotion_motion` 必须输出一个 `image_still` 锚点图和一个 `render_motion_cue`，并禁止输出 `video_clip`",
    );
    expect(planner.body).not.toContain("无偏好时按预算与降级策略选择");
    expect(planner.body).toContain("首个分块的第一段");
    expect(planner.body).toContain("非首个分块禁止输出 `global`");
    expect(planner.body).toContain("asset_kind");
    expect(planner.body).toContain("planning_mode");
    expect(planner.body).toContain("source_segment_id");
    expect(planner.body).not.toContain("生成 task_id");
    expect(repair.body).toContain("严格 `SegmentIntentRepairPatch`");
    expect(repair.body).toContain("只修复 `allowed_operations`");
    expect(repair.body).toContain("replace_field");
    expect(repair.body).toContain("append_intent");
    expect(repair.body).toContain("不得完整重写");
    expect(repair.body).not.toContain("分析 message");
    for (const narrativeEnglish of [
      "typed operations",
      "visual strategy preference",
      "global BGM owner",
      "正式 wire",
      "正式 schema",
      "对应正式 schema",
    ]) {
      expect(planner.body).not.toContain(narrativeEnglish);
      expect(repair.body).not.toContain(narrativeEnglish);
    }
  });

  it("keeps the repair prompt JSON example valid against the canonical patch schema", () => {
    const repair = createPromptRegistry().getPrompt(
      "asset-planning.segment-intent-repair",
    );
    const example = repair.body.match(/```json\n([\s\S]*?)\n```/u)?.[1];

    expect(example).toBeDefined();
    expect(() =>
      SegmentIntentRepairPatch.parse(JSON.parse(example!)),
    ).not.toThrow();
    expect(example).toContain('"production_intent"');
    expect(example).toContain('"image_prompt"');
    expect(example).toContain('"video_prompt_reserve"');
    expect(example).toContain('"image_role"');
    expect(example).toContain('"support_reason"');
    expect(example).toContain('"risk_notes"');
    expect(repair.body).toContain(
      "其他 `expected_kind` 必须按正式输出结构提交对应联合类型的完整对象",
    );
    expect(repair.body).not.toContain("示例仅展示");
  });

  it("associates segment intent prompt outputs with the canonical schemas", () => {
    expect(SEGMENT_INTENT_PLANNER_OUTPUT_SCHEMA).toBe(
      SegmentAssetIntentBatchDraft,
    );
    expect(SEGMENT_INTENT_REPAIR_OUTPUT_SCHEMA).toBe(
      SegmentIntentRepairPatch,
    );
  });
  it("loads topic.candidate-builder from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.metadata.id).toBe("topic.candidate-builder");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/prompts/topic/");
    expect(prompt.body).toContain("根据当前推荐种子");
  });

  it("keeps high-tension history concrete while using provider-safe planning language", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("保留具体人物");
    expect(prompt.body).toContain("明确赌注");
    expect(prompt.body).toContain("不展开具体血腥");
    expect(prompt.body).toContain("strict_neutral_historical_planning");
    expect(prompt.body).toContain("不得因为安全表达");
  });

  it("keeps prompt metadata zh-CN and includes diversity instructions for open discovery", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("开放发现差异化要求");
    expect(prompt.body).toMatch(/事件.*多样性/);
    expect(prompt.body).toMatch(/角度.*明显不同/);
  });

  it("keeps builder focused on open discovery while reusing prior event identities from recent memory", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("recent_event_memory");
    expect(prompt.body).toContain("复用已有");
    expect(prompt.body).toContain("`event_identity`");
  });

  it("keeps builder source expansion lightweight while preventing recent hot events from dominating the raw pool", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    // 候选数量已从固定 8 改为由 target_candidate_count 控制（缺省 8）；
    // 测试只锁定"原始候选池 + 数量硬约束 + 防热点霸占"的语义不变。
    expect(prompt.body).toContain("target_candidate_count");
    expect(prompt.body).toContain("原始候选池");
    expect(prompt.body).toContain("大多数槽位");
    expect(prompt.body).toContain("朝代分布");
    expect(prompt.body).toContain("冲突类型");
    expect(prompt.body).toContain("叙事结构");
    expect(prompt.body).not.toContain("至少覆盖 3 个朝代");
  });

  it("keeps candidate must_cover_preview ordered for peak scene absorption", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`must_cover_preview` 三条顺序");
    expect(prompt.body).toContain("第一条必须是具体开场压力");
    expect(prompt.body).toContain("第二条必须是压力转折或高潮兑现");
    expect(prompt.body).toContain("第三条必须是故事内余震");
    expect(prompt.body).toContain("第二条不得只写准备、训练、铺垫或泛泛强场面");
  });

  it("keeps candidate preview grounded for opening pressure and story residue", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("第一条必须是具体开场压力");
    expect(prompt.body).toContain("人物、逼迫动作、即将失去的东西");
    expect(prompt.body).toContain("第二条必须是压力转折或高潮兑现");
    expect(prompt.body).toContain("第三条必须是故事内余震");
    expect(prompt.body).toContain("不得写成脱离故事的现代金句");
  });

  it("gives builder a single legal TopicCandidateCard[] output skeleton", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("唯一合法输出骨架");
    expect(prompt.body).toContain("`TopicCandidateCard[]`");
    expect(prompt.body).toContain("\"event_identity\"");
    expect(prompt.body).toContain("\"title\"");
    expect(prompt.body).toContain("\"one_line_angle\"");
    expect(prompt.body).toContain("\"family_label\"");
    expect(prompt.body).toContain("\"scope_label\"");
    expect(prompt.body).not.toContain("\"TopicCandidateCard\": [");
  });

  it("keeps builder-repair focused on filling missing fields without reopening discovery", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("缺失字段");
    expect(prompt.body).toContain("不重开候选发现");
    expect(prompt.body).toContain("不得新增候选");
    expect(prompt.body).toContain("不得改写已有 `event_identity`");
  });

  it("normalizes annotation lines before rendering markdown interaction notes", () => {
    const markdown = renderLlmInteractionMarkdown({
      sequence: 1,
      generatedAt: "2026-04-29T00:00:00.000Z",
      provider: "stub",
      model: "stub",
      operationName: "topic.candidate-builder",
      promptId: "topic.candidate-builder",
      promptStage: "topic",
      promptLanguage: "zh-CN",
      promptFilePath: "prompts/topic/candidate-builder.prompt.md",
      systemPrompt: "prompt",
      input: {
        seed: "topic",
      },
      rawOutput: "[]",
      parsedOutput: [],
      annotations: ["候选保留：第一槽位\n- 注入项\n```code```"],
      errorMessage: null,
    });

    expect(markdown).toContain("## 归因注记");
    expect(markdown).toContain("- 候选保留：第一槽位");
    expect(markdown).not.toContain("\n- 注入项");
    expect(markdown).not.toContain("```code```");
  });

  it("loads script.script-writer through registry compatibility lookup", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.script-writer");

    expect(prompt.metadata.id).toBe("script.writer");
    expect(prompt.aliases).toContain("script.script-writer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/prompts/script/");
  });

  it("loads storyboard.storyboard-planner from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("storyboard.storyboard-planner");

    expect(prompt.metadata.id).toBe("storyboard.planner");
    expect(prompt.metadata.stage).toBe("storyboard");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain(
      "/prompts/storyboard/",
    );
    expect(prompt.body).toContain("StoryboardPlan");
    expect(prompt.body).toContain("script_excerpt");
    expect(prompt.body).toContain("不得改写 script_text");
    expect(prompt.body).toContain("不得输出素材生成任务");
  });

  it("loads asset-planning.asset-planner from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("asset-planning.asset-planner");

    expect(prompt.metadata.id).toBe("asset-planning.planner");
    expect(prompt.metadata.stage).toBe("asset_planning");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain(
      "/prompts/asset-planning/",
    );
    expect(prompt.body).toContain("AssetPlan");
    expect(prompt.body).toContain("ProjectArtBible");
    expect(prompt.body).toContain("根据 `StoryboardSegment.narrative_role` 规划听觉张力");
    expect(prompt.body).toContain("sfx_cue");
    expect(prompt.body).toContain("bgm_cue");
    expect(prompt.body).toContain("opening、turn、peak");
    expect(prompt.body).toContain('"character_id"');
    expect(prompt.body).toContain('"visual_description"');
    expect(prompt.body).toContain('"location_id"');
    expect(prompt.body).toContain('"prop_id"');
    expect(prompt.body).toContain("locations 和 props 不得包含 `role`");
    expect(prompt.body).toContain("label 优先使用中文历史实名");
    expect(prompt.body).toContain("role 写叙事功能");
    expect(prompt.body).toContain("主字段必须使用中文");
    expect(prompt.body).toContain("不得把核心人物写成英文泛称");
    expect(prompt.body).toContain("prompt_draft 必须优先使用中文");
    expect(prompt.body).toContain("prompt_draft 不得整段写成英文");
    expect(prompt.body).toContain("risk_notes 等主字段必须使用中文");
    expect(prompt.body).toContain("video_clip 只给连续动作是叙事核心的镜头");
    expect(prompt.body).toContain("why_static_insufficient");
    expect(prompt.body).toContain("人物说话、表情变化、象征画面、短促碎裂动作默认不得规划 video_clip");
    expect(prompt.body).toContain("每个 video_clip 必须依赖同 segment 的 image_still");
    expect(prompt.body).toContain("static_fallback_task_id");
    expect(prompt.body).toContain("video_clip 到 image_still 的 requires_output 依赖");
    expect(prompt.body).toContain("视觉类任务 risk_notes 必须非空");
    expect(prompt.body).toContain("战争、刺杀、伏击、尸骨、血战");
    expect(prompt.body).toContain("避免现代轮椅、金属轮椅、橡胶轮胎、现代医疗器械");
    expect(prompt.body).toContain("不得把奇幻毒果、怪诞植物等象征物固化为核心资产");
    expect(prompt.body).toContain("每个 task 都必须填写非空 source_excerpt");
    expect(prompt.body).toContain("sfx_cue 和 bgm_cue 也不得省略 source_excerpt");
    expect(prompt.body).toContain("recommended_mode 只能使用 auto、manual_allowed、manual_preferred、placeholder_only");
    expect(prompt.body).toContain("不得输出 automatic");
    expect(prompt.body).toContain('"image_role": "anchor"');
    expect(prompt.body).toContain('"support_reason"');
    expect(prompt.body).toContain("每个 segment 最多一个主锚点");
    expect(prompt.body).toContain("requires_output / requires_timing / requires_selection");
    expect(prompt.body).toContain("不得输出 `tts_audio` 或 `subtitle_track` 任务");
    expect(prompt.body).toContain("局部临时 ID");
    expect(prompt.body).toContain("segment chunk");
    expect(prompt.body).toContain("不得生成图片、视频、音频、字幕或 compose 时间轴");
    expect(prompt.body).toContain("不得修改 script_text、StoryboardPlan 或 TopicPackage");
  });

  it("loads asset-planning.asset-structural-repair from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("asset-planning.asset-structural-repair");

    expect(prompt.metadata.id).toBe("asset-planning.asset-structural-repair");
    expect(prompt.metadata.stage).toBe("asset_planning");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain(
      "/prompts/asset-planning/",
    );
    expect(prompt.body).toContain("只修复结构性缺口");
    expect(prompt.body).toContain("不得修改 topic、script、storyboard");
    expect(prompt.body).toContain("不得输出 tts_audio 或 subtitle_track");
    expect(prompt.body).toContain("本地逻辑只定位缺口，不代写风险文案");
  });

  it("loads asset-planning.global-structural-repair with its exact registry contract", () => {
    const prompt = createPromptRegistry().getPrompt(
      "asset-planning.global-structural-repair",
    );

    expect(prompt.metadata).toMatchObject({
      id: "asset-planning.global-structural-repair",
      version: "v1.0.0",
      stage: "asset_planning",
      language: "zh-CN",
      consumes: ["GlobalPlanningStructuralRepairInput"],
      produces: ["GlobalPlanningStructuralPatch"],
      status: "active",
    });
    expect(prompt.body).toContain("allowed_repair_paths");
    expect(prompt.body).toContain("normalized_draft");
    expect(prompt.body).toContain("repair_context");
    expect(prompt.body).toContain("global_planning_structural_patch");
    expect(prompt.body).toContain("不得输出 Markdown");
    expect(prompt.body).toContain("不得输出 segment tasks");
    expect(prompt.body).toContain("不得输出 dependencies");
  });

  it("documents asset planning chunk required field checklist", () => {
    const registry = createPromptRegistry();
    const prompt = registry.getPrompt("asset-planning.planner");

    expect(prompt.body).toContain("每个 chunk task 必须显式输出");
    expect(prompt.body).toContain("provider_hint");
    expect(prompt.body).toContain("prompt_draft");
    expect(prompt.body).toContain("manual_upload_policy");
    expect(prompt.body).toContain("risk_notes");
    expect(prompt.body).toContain("video_clip 必须说明 static_fallback_task_id");
  });

  it("documents compact asset planning chunk structural patch mode", () => {
    const registry = createPromptRegistry();
    const prompt = registry.getPrompt("asset-planning.asset-structural-repair");

    expect(prompt.body).toContain("segment_chunk_structural_patch");
    expect(prompt.body).toContain("只输出 task_patches 和 dependency_patches");
    expect(prompt.body).toContain("不要返回完整 chunk draft");
    expect(prompt.body).toContain("不得新增当前 chunk 之外的 local_task_id");
  });

  it("does not show empty risk_notes in the asset planning visual task skeleton", () => {
    const prompt = createPromptRegistry().getPrompt("asset-planning.asset-planner");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).not.toContain('"risk_notes": []');
    expect(prompt.body).toContain(
      '"risk_notes": ["说明平台安全、历史准确性或生成稳定性风险"]',
    );
  });

  it("guides storyboard planning quality through prompt constraints instead of local semantic validation", () => {
    const prompt = createPromptRegistry().getPrompt("storyboard.storyboard-planner");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("战争、刺杀、伏击、兵刃逼近");
    expect(prompt.body).toContain("risk_notes");
    expect(prompt.body).toContain("避免现代物件或现代隐喻");
    expect(prompt.body).toContain("轮椅");
    expect(prompt.body).toContain("绞肉机");
    expect(prompt.body).toContain("象征镜头必须保持历史质感");
    expect(prompt.body).toContain("直接承载上游 beat 的 segment 必须填写 linked_beats");
    expect(prompt.body).toContain("桥接段、纯氛围段或结尾余韵段可以留空");
    expect(prompt.body).toContain("不得把脚本里的结尾判断扩写成未在 script_text 出现的后续剧情");
    expect(prompt.body).not.toContain("本地 validator 判断是否爆款");
  });

  it("keeps script writer opening contract scene-grounded without treating hook_claim as a draft template", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("第二分句立刻落到具体历史场面、动作或危险局面");
    expect(prompt.body).toContain("`hook_claim` 只是包装 promise 弱参考");
    expect(prompt.body).toContain("不能机械复述或照搬");
    expect(prompt.body).toContain("不使用固定统一开头模板");
    expect(prompt.body).not.toContain(
      "前两句必须直接复用 `hook_claim` 或 `strong_scene`",
    );
  });

  it("requires script writer openings to break the fourth wall before entering the scene", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("破壁开头");
    expect(prompt.body).toContain("第一分句必须包含本事件的具体人物或势力");
    expect(prompt.body).toContain("第二分句立刻落到具体历史场面");
    expect(prompt.body).toContain("不得为了开头铺垫而空泛解释背景");
    expect(prompt.body).toContain("不使用固定统一开头模板");
  });

  it("requires break-wall openings to start from concrete actors and pressure", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("第一分句必须包含本事件的具体人物或势力");
    expect(prompt.body).toContain("压力源、选择或代价");
    expect(prompt.body).toContain("优先从 `core_conflict`、`stakes` 或 `narrative_tension_map` 提炼");
    expect(prompt.body).toContain("不要用泛称惊叹替代具体压力");
    expect(prompt.body).not.toContain("如“你敢相信吗”“你有没有想过”“你可曾想过”");
  });

  it("keeps script writer focused on oral story drafts instead of summaries", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("不能写成摘要稿");
    expect(prompt.body).toContain("每个 `must_include_beats` 要写成局面推进");
    expect(prompt.body).toContain("至少一个核心场面包含人物、动作、压力源、即时后果");
    expect(prompt.body).toContain("问句后必须进入具体场面");
    expect(prompt.body).toContain("结尾要留下代价、反讽或判断");
  });

  it("keeps script writer compatible with JSON mode providers", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("合法 JSON 对象");
    expect(prompt.body).toContain("JSON 输出骨架");
    expect(prompt.body).toContain('"script_text"');
    expect(prompt.body).toContain('"estimated_duration_sec"');
    expect(prompt.body).toContain('"opening_span"');
    expect(prompt.body).toContain('"ending_span"');
    expect(prompt.body).toContain("不得输出 Markdown 或解释文字");
  });

  it("keeps script writer endings anchored to residue instead of generic historical praise", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("ending_span");
    expect(prompt.body).toContain("代价、反讽、未平后果或场景内判断");
    expect(prompt.body).toContain("不要默认写成改变历史、成为典范、留名史册式空泛收尾");
  });

  it("tells script writer to honor regen context structural floors without changing topic contract", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`regeneration_context`");
    expect(prompt.body).toContain("不得改写 `TopicPackage`");
    expect(prompt.body).toContain("min_script_chars_for_band");
    expect(prompt.body).toContain("min_sentence_count_for_band");
    expect(prompt.body).toContain("下限");
  });

  it("requires thin-draft regeneration to expand existing beats instead of rephrasing the same short draft", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("如 `regeneration_context` 指出 `script_body_too_thin`");
    expect(prompt.body).toContain("必须沿用既有 `must_include_beats` 扩写");
    expect(prompt.body).toContain("新增场景动作、对方反应、压力后果");
    expect(prompt.body).toContain("不得只重排、改写或缩短上一稿");
  });

  it("requires thin-draft regeneration to clear the floor comfortably with beat-level substance", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("script_body_too_thin");
    expect(prompt.body).toContain("不能只刚刚贴线");
    expect(prompt.body).toContain("要明显高于 `min_script_chars_for_band`");
    expect(prompt.body).toContain("每条 beat 至少补足一个动作、一个反应、一个后果");
    expect(prompt.body).toContain("不得写成比上一稿稍长一点的压缩摘要");
  });

  it("requires sparse-material thin regen to add pre-action reaction and consequence around existing beats", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("script_body_too_thin");
    expect(prompt.body).toContain("quote_trace");
    expect(prompt.body).toContain("动作前一拍");
    expect(prompt.body).toContain("即时反应");
    expect(prompt.body).toContain("后果句");
    expect(prompt.body).toContain("不得新增人物、事件、结局或改写因果");
    expect(prompt.body).toContain("可以补原场景内不改变事实的动作、反应、停顿、目光、场面压力");
  });

  it("requires medium body volume to come from narrative substance instead of padding", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`medium` 首稿正文优先写到约 330-450 个汉字等价长度");
    expect(prompt.body).toContain("如果正文只有 320-360 字，估时应更保守");
    expect(prompt.body).toContain("只能用场景、动作、对话或转述、压力升级、即时后果补足体量");
    expect(prompt.body).toContain("不得为了凑字数重复解释、空泛评价或喊口号");
  });

  it("requires script writer duration estimates to be backed by body volume", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`medium` 首稿正文优先写到约 330-450 个汉字等价长度");
    expect(prompt.body).toContain("按约 3.6-4.6 个汉字等价长度/秒回填");
    expect(prompt.body).toContain("如果正文只有 320-360 字，估时应更保守");
    expect(prompt.body).toContain("不能硬标 85-90 秒");
  });

  it("requires script writer to maintain pacing and scene density through the middle", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("每 2-3 句必须出现新的动作、对方反应、场面压力变化或即时后果");
    expect(prompt.body).toContain("每条 beat 至少写出一个可见动作和一个反应或后果");
    expect(prompt.body).toContain("不要连续写三句以上背景解释、抽象评价或历史意义");
  });

  it("requires each script beat to become a developed narrative unit instead of compressed coverage", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("每条 `must_include_beats` 至少展开成一个叙事单元");
    expect(prompt.body).toContain("不能只用一句话点名后立刻跳到下一条 beat");
    expect(prompt.body).toContain("人物动作、对方反应、场面压力、即时后果");
    expect(prompt.body).toContain("三条 beat 不能压缩成列表式交代");
  });

  it("separates natural script text from beat trace audit fields", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`beat_trace.beat` 是审计字段");
    expect(prompt.body).toContain("`script_text` 是口播正文");
    expect(prompt.body).toContain("每条 beat 必须吸收成局面推进");
    expect(prompt.body).toContain("`beat_trace.excerpt` 必须从自然正文截取");
  });

  it("requires beat trace excerpts to be continuous verbatim script substrings", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`beat_trace.excerpt` 必须是 `script_text` 中连续、逐字一致的原文子串");
    expect(prompt.body).toContain("不得用 `……`、省略号、改写或拼接多个不相邻片段");
    expect(prompt.body).toContain("截取对话时连同正文里的引号和标点一起复制");
    expect(prompt.body).toContain("不少于 14 个汉字等价长度");
  });

  it("keeps script writer audit fields separate from spoken prose without label recitation", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("审计字段与正文边界");
    expect(prompt.body).toContain("`beat_trace.beat` 是审计字段，必须逐字复用输入 beat");
    expect(prompt.body).toContain(
      "`script_text` 是口播正文，不得把 `must_include_beats` 原句当标签、清单或解释句逐条复述",
    );
    expect(prompt.body).toContain(
      "每条 beat 必须吸收成局面推进，至少包含动作、反应、压力变化或后果中的一个具体元素",
    );
    expect(prompt.body).toContain("`beat_trace.excerpt` 必须从自然正文截取");
    expect(prompt.body).toContain("`canonical_quote_intents` 必须通过场面目的和结尾回响兑现");
  });

  it("requires script writer to honor canonical quote intents when present", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`canonical_quote_intents`");
    expect(prompt.body).toContain("`intent`");
    expect(prompt.body).toContain("不改成其他寓意");
  });

  it("loads script.semantic-reviewer from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.semantic-reviewer");

    expect(prompt.metadata.id).toBe("script.semantic-reviewer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("执行单一语义审校");
  });

  it("keeps script semantic reviewer calibrated for off-contract and weak-lift boundaries", () => {
    const prompt = createPromptRegistry().getPrompt("script.semantic-reviewer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("完全换成无关题材");
    expect(prompt.body).toContain("优先判为 `return_topic`");
    expect(prompt.body).toContain("结构覆盖但表达像梗概");
    expect(prompt.body).toContain("可判 `patch_once/lift`");
    expect(prompt.body).toContain("不能因此压低首稿通过率");
    expect(prompt.body).toContain("不能仅因所有 `must_include_beats` 已覆盖就判 `pass`");
  });

  it("invokes script.semantic-reviewer through the prompt registry and llm gateway", async () => {
    const { reviewScriptSemantics } = await import(
      "../../../backend/src/modules/script/script-semantic-review.service.js"
    );
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const reviewerOutput = {
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["hook_kill_power_weak"],
      patch_targets: ["opening"],
      summary: "开头抓力不足，建议只做影子评估记录。",
      confidence: 0.78,
    };
    const invokeApi = vi.fn(async () => ({ rawOutput: JSON.stringify(reviewerOutput), content: JSON.stringify(reviewerOutput), metadata: {} }));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const bundle = {
      hard_lane: {
        must_include_beats: ["入楚受辱"],
        scope_label: "完整事件",
        selected_angle: "楚王连压三次，晏子一次没退。",
      },
      soft_lane: {
        narrative_tension_map: {
          hook_claim: "楚王连压三次",
          pressure_escalation: "压力逐层升级",
          mid_reveal: "晏子守住场面",
          peak_payoff: "橘枳之喻顶回去",
          ending_residue: "一退就不只是退掉自己",
        },
      },
    };
    const draft = {
      script_text: "楚王连续压场，晏子一句句顶回去。",
      opening_span: "楚王连续压场，晏子一句句顶回去。",
      ending_span: "一退就不只是退掉自己。",
    };

    const result = await reviewScriptSemantics({
      bundle,
      draft,
      llmGateway: gateway,
    } as any);

    expect(result).toMatchObject(reviewerOutput);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "script.semantic-reviewer",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "script.semantic-reviewer",
            language: "zh-CN",
          }),
        }),
        input: {
          bundle,
          draft,
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("delegates invokeStructuredPrompt through the provider contract", async () => {
    const interactionLogWriter = {
      write: vi.fn(),
    };
    const invokeStructuredPrompt = vi.fn(async (request: StructuredPromptInvocation) => {
      const { prompt, input, operationName } = request;

      return {
        promptId: prompt.metadata.id,
        input,
        operationName,
      };
    });
    const provider: StructuredPromptProvider = {
      invokeStructuredPrompt: async <T>(request: StructuredPromptInvocation): Promise<T> =>
        invokeStructuredPrompt(request) as Promise<T>,
    };
    const gateway = createLlmGateway({
      provider,
      registry: createPromptRegistry(),
    });

    const result = await gateway.invokeStructuredPrompt<{
      promptId: string;
      input: unknown;
      operationName: string;
    }>({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
      interactionLogWriter,
    });

    expect(invokeStructuredPrompt).toHaveBeenCalledTimes(1);
    expect(invokeStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          requestId: "seed-1",
        },
        operationName: "topic.candidate-builder",
        interactionLogWriter,
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.candidate-builder",
            language: "zh-CN",
          }),
        }),
      }),
    );
    expect(result).toEqual({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
      operationName: "topic.candidate-builder",
    });
  });

  it("delegates invokeStrictStructured through the provider contract", async () => {
    const interactionLogWriter = {
      write: vi.fn(),
    };
    const provider: StructuredPromptProvider = {
      invokeStructuredPrompt: vi.fn(),
      invokeStrictStructured: vi.fn(async ({ schema, parse }) =>
        parse({
          schemaName: schema.name,
        }),
      ),
    };
    const gateway = createLlmGateway({
      provider,
      registry: createPromptRegistry(),
    });

    const result = await gateway.invokeStrictStructured<{
      schemaName: string;
    }>({
      promptId: "topic.selector",
      input: {
        selector_pool: [],
      },
      operationName: "topic.selector",
      schema: {
        name: "select_topic_candidates",
        description: "Select topic candidates.",
        parameters: {
          type: "object",
          properties: {
            selected_candidate_ids: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          required: ["selected_candidate_ids"],
          additionalProperties: false,
        },
      },
      parse: (candidate) => candidate as { schemaName: string },
      options: {
        strategy: "tool_call",
        thinking: "disabled",
      },
      interactionLogWriter,
    });

    expect(provider.invokeStrictStructured).toHaveBeenCalledTimes(1);
    expect(provider.invokeStrictStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          selector_pool: [],
        },
        operationName: "topic.selector",
        interactionLogWriter,
        schema: expect.objectContaining({
          name: "select_topic_candidates",
        }),
        options: expect.objectContaining({
          strategy: "tool_call",
          thinking: "disabled",
        }),
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.selector",
            language: "zh-CN",
          }),
        }),
      }),
    );
    expect(result.schemaName).toBe("select_topic_candidates");
  });

  it("classifies rate limits as retryable external service errors and retries once", async () => {
    const { ExternalServiceError, withRetry } = await import(
      "../../../backend/src/runtime/llm/external-errors.js"
    );

    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("429 rate limit exceeded");
        }

        return "ok";
      },
      {
        provider: "llm",
        operation: "topic.candidate-builder",
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);

    try {
      await withRetry(
        async () => {
          throw new Error("401 unauthorized api key");
        },
        {
          provider: "llm",
          operation: "topic.candidate-builder",
          maxAttempts: 1,
          baseDelayMs: 0,
          maxDelayMs: 0,
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(error).toMatchObject({
        retryable: false,
        code: "configuration",
        operation: "topic.candidate-builder",
        provider: "llm",
      });
    }
  });

  it("uses the openai-compatible provider through the unified prompt contract", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const invokeApi = vi.fn(async ({ prompt, input, operationName }) => {
      const content = JSON.stringify({
        promptId: prompt.metadata.id,
        operationName,
        input,
      });
      return { rawOutput: content, content, metadata: {} };
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
    });
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    const result = await provider.invokeStructuredPrompt<{
      promptId: string;
      operationName: string;
      input: { seed: string };
    }>({
      prompt,
      input: {
        seed: "family-slot",
      },
      operationName: "topic.candidate-builder",
    });

    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt,
        input: {
          seed: "family-slot",
        },
        operationName: "topic.candidate-builder",
        model: "glm-4.5",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({
      promptId: "topic.candidate-builder",
      operationName: "topic.candidate-builder",
      input: {
        seed: "family-slot",
      },
    });
  });

  it("retries transient failures inside the openai-compatible provider", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const invokeApi = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce({ rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
      timeoutMs: 10,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await provider.invokeStructuredPrompt<{ ok: boolean }>({
      prompt: createPromptRegistry().getPrompt("topic.candidate-builder"),
      input: {
        seed: "family-slot",
      },
      operationName: "topic.candidate-builder",
    });

    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it("does not retry timeout failures for long structured generation", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const invokeApi = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("request timeout"), { name: "AbortError" }));
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
      timeoutMs: 10,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    await expect(
      provider.invokeStructuredPrompt<{ ok: boolean }>({
        prompt: createPromptRegistry().getPrompt("topic.candidate-builder"),
        input: { seed: "family-slot" },
        operationName: "topic.candidate-builder",
      }),
    ).rejects.toMatchObject({ code: "timeout", attemptCount: 1 });

    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("runs deterministic recovery before auto-fix for structured output repair", async () => {
    const { createStructuredOutputFixer } = await import(
      "../../../backend/src/runtime/llm/structured-output-fix.js"
    );
    const autoFix = vi.fn(async () => '{"value": 3}');
    const fixer = createStructuredOutputFixer({
      autoFix,
    });

    const result = await fixer.fix<{ value: number }>({
      operationName: "topic.candidate-builder",
      rawOutput: '{"value": 2',
      parse: (candidate) => JSON.parse(candidate) as { value: number },
      deterministicRecovery: (rawOutput) => `${rawOutput}}`,
    });

    expect(result).toEqual({ value: 2 });
    expect(autoFix).not.toHaveBeenCalled();
  });

  it("falls back to auto-fix after deterministic recovery cannot repair structured output", async () => {
    const { createStructuredOutputFixer } = await import(
      "../../../backend/src/runtime/llm/structured-output-fix.js"
    );
    const autoFix = vi.fn(async ({ rawOutput }) => {
      expect(rawOutput).toBe("not-json");
      return '{"value": 4}';
    });
    const fixer = createStructuredOutputFixer({
      autoFix,
    });

    const result = await fixer.fix<{ value: number }>({
      operationName: "script.semantic-reviewer",
      rawOutput: "not-json",
      parse: (candidate) => JSON.parse(candidate) as { value: number },
      deterministicRecovery: () => null,
    });

    expect(autoFix).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ value: 4 });
  });
  it("keeps selector focused on choosing from the pool while considering recent event memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("recent_event_memory");
    expect(prompt.body).toContain("语义上等价或明显过近");
  });

  it("requires selector to deduct cross-field semantic contradictions without rewriting candidates", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("具体主体");
    expect(prompt.body).toContain("关键动作");
    expect(prompt.body).toContain("因果关系");
    expect(prompt.body).toContain("source_or_scope_risk");
    expect(prompt.body).toContain("不得改写候选");
  });
});
