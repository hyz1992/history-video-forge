import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildProductAcceptanceLiveCheckPlan,
  loadProductAcceptanceSource,
  parseProductAcceptanceLiveCheckCliArgs,
  seedProductAcceptanceProject,
} from "../../harness/scripts/runtime/product-acceptance-live-check";

describe("product acceptance live-check harness", () => {
  it("parses source, BGM and explicit real provider options", () => {
    expect(
      parseProductAcceptanceLiveCheckCliArgs([
        "--source-dir",
        "harness/scripts/runtime/output/source-a",
        "--output-dir",
        "harness/scripts/runtime/output/accept-a",
        "--bgm-id",
        "bgm_hist_ancient_china_solemn_001",
        "--dashscope-image-model",
        "wan2.6-t2i",
        "--dashscope-tts-model",
        "qwen3-tts-instruct-flash",
      ]),
    ).toMatchObject({
      sourceDir: "harness/scripts/runtime/output/source-a",
      outputDir: "harness/scripts/runtime/output/accept-a",
      bgmLibraryItemId: "bgm_hist_ancient_china_solemn_001",
      dashscope: {
        imageModel: "wan2.6-t2i",
        ttsModel: "qwen3-tts-instruct-flash",
      },
    });
  });

  it("builds an explicit live-check plan with subtitle requirements", () => {
    const plan = buildProductAcceptanceLiveCheckPlan({
      outputDir: "out",
      sourceDir: "source",
    });

    expect(plan.automated_gate).toBe(false);
    expect(plan.requires_real_env).toBe(true);
    expect(plan.provider_mode).toBe("dashscope");
    expect(plan.disabled_providers).toContain("dashscope_image_to_video");
    expect(plan.disabled_task_types).toContain("sfx_cue");
    expect(plan.required_artifacts).toContain("execution-asset-plan.json");
    expect(plan.required_checks).toContain(
      "render subtitle_cue_count must be greater than 0",
    );
  });

  it("loads source topic, script and storyboard and seeds active project records", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-acceptance-source-"));
    writeFileSync(
      join(sourceDir, "source-topic-package.json"),
      JSON.stringify(makeTopicPackageFixture()),
      "utf8",
    );
    writeFileSync(
      join(sourceDir, "source-script-draft.json"),
      JSON.stringify(makeScriptDraftFixture()),
      "utf8",
    );
    writeFileSync(
      join(sourceDir, "source-storyboard-plan.json"),
      JSON.stringify(makeStoryboardPlanFixture()),
      "utf8",
    );

    const source = loadProductAcceptanceSource(sourceDir);
    const seeded = await seedProductAcceptanceProject({
      source,
      outputDir: mkdtempSync(join(tmpdir(), "svf2-acceptance-output-")),
    });

    expect(source.topicPackage.title).toBe("晏子使楚");
    expect(seeded.project.activeTopicPackageId).toBeTruthy();
    expect(seeded.project.activeScriptRecordId).toBeTruthy();
    expect(seeded.project.activeStoryboardRecordId).toBeTruthy();
    expect(seeded.app.db.storyboardRecords.size).toBe(1);
  });
});

function makeTopicPackageFixture() {
  return {
    topic_id: "topic_yanzi_acceptance",
    title: "晏子使楚",
    selected_angle: "楚王设局羞辱齐人，晏子用一句话反压全场。",
    family_label: "春秋外交",
    scope_label: "单事件",
    core_conflict: "楚王想借囚犯羞辱齐国，晏子必须当场反击。",
    stakes: "如果回答失手，齐国使者会在楚廷失去体面。",
    strong_scene: "楚王指着囚犯发问，满殿等着晏子出丑。",
    packaging_seed: "一场外交羞辱被一句话翻盘。",
    must_include_beats: [
      "楚王设局",
      "晏子观察囚犯",
      "橘生淮南则为橘的反击",
    ],
    forbidden_expansions: ["不要扩写到未确认的后续战争"],
    risk_hints: ["避免现代政治词汇"],
    source_anchor_refs: ["《晏子春秋》相关故事"],
    canonical_quotes: ["橘生淮南则为橘，生于淮北则为枳"],
    canonical_quote_intents: [
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        intent: "用环境反讽楚国治理",
      },
    ],
    ambiguity_notes: ["不同版本细节略有差异"],
    duration_band: "medium",
    narrative_tension_map: {
      hook_claim: "楚王当众挖坑，晏子不能退。",
      pressure_escalation: "囚犯被带上殿，羞辱从暗处推到明处。",
      mid_reveal: "晏子不急着辩解，先顺着楚王的问题走。",
      peak_payoff: "一句橘枳之别，把羞辱还给楚国。",
      ending_residue: "真正被审问的不是齐人，而是楚国的水土。",
    },
  };
}

function makeScriptDraftFixture() {
  return {
    script_text:
      "楚王把一个囚犯押到殿前，故意问晏子：齐国人都善于偷盗吗？满殿的人都等着看这个矮小的使者出丑。晏子没有急着争辩，只是看了看那个囚犯，又看向楚王。他说，橘生淮南则为橘，生于淮北则为枳。不是种子变坏了，是水土变了。殿上忽然安静下来。楚王本想羞辱齐国，最后却把楚国自己摆到了众人面前。",
    estimated_duration_sec: 34,
    beat_trace: [
      {
        beat: "楚王设局",
        excerpt: "楚王把一个囚犯押到殿前",
        confidence: 0.95,
      },
      {
        beat: "晏子反击",
        excerpt: "橘生淮南则为橘，生于淮北则为枳",
        confidence: 0.95,
      },
    ],
    quote_trace: [
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        usage_type: "exact",
        excerpt: "他说，橘生淮南则为橘，生于淮北则为枳。",
      },
    ],
    opening_span: "楚王把一个囚犯押到殿前，故意问晏子：齐国人都善于偷盗吗？",
    ending_span: "楚王本想羞辱齐国，最后却把楚国自己摆到了众人面前。",
  };
}

function makeStoryboardPlanFixture() {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "script_yanzi_acceptance",
    source_topic_package_id: "topic_yanzi_acceptance",
    estimated_total_duration_sec: 34,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "楚王把一个囚犯押到殿前，故意问晏子。",
        start_hint_sec: 0,
        end_hint_sec: 12,
        narrative_role: "opening",
        visual_intent: "楚廷公开羞辱的压力",
        scene_description: "古代楚国宫殿内，囚犯被带到殿前，群臣侧目。",
        visual_elements: ["楚王", "晏子", "囚犯", "宫殿"],
        framing_hint: "wide",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["楚王设局"],
        linked_quotes: [],
        risk_notes: ["避免现代服饰和文字水印"],
      },
    ],
    global_visual_notes: ["整体保持中国古代历史正剧质感"],
  };
}
