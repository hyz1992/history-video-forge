import type { AssetPlan, StoryboardPlan } from "../../../../shared/src/index.js";

export interface AssetVisualPromptEnrichmentInput {
  taskType:
    | "image_still"
    | "video_clip"
    | "render_motion_cue"
    | "sfx_cue"
    | "bgm_cue"
    /**
     * 角色 sheet（2026-09-18 设计 §3.7 第 6 项）：任务类型面在此保持完整。
     * 其 prompt 由本文件的 buildCharacterSheetPrompt 组装，不走 [角色锚点] 分支
     *（sheet 自身就是角色锚点，自引用无意义）。
     */
    | "character_sheet";
  promptDraft: string | null;
  sourceSegmentId: string;
  storyboardSegments: StoryboardPlan["segments"];
  artBible: AssetPlan["art_bible"];
}

const VISUAL_CONSTRAINT_BASE =
  "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合%s背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感";

/**
 * 定妆图布局约束（2026-09-18 设计 §3.2）。与 VISUAL_CONSTRAINT_BASE 同级管理：
 * 确定性字符串常量，全程无 LLM 调用，不属于 prompt 资产，因此不放 prompts/。
 */
const CHARACTER_SHEET_LAYOUT =
  "定妆参考图，单人正面自然站立，镜头拉远的全身远景，头顶至双脚及脚下地面完整入画，人物居中且四周留白，符合时代的单套中性服饰，简洁纯色背景，无兵器、无同人多姿态、无多套服装对照、无其他人物、无文字、无分镜构图";

const CHARACTER_SHEET_ERA_CONSTRAINT =
  "发型、服饰、器物形制必须符合%s背景，无现代物品、无现代建筑、无民国/近代造型";

/** 新计划消费稳定身份；旧计划完整回退，不在本地从造型描述抽取语义。 */
export function characterIdentityDescription(
  character: AssetPlan["art_bible"]["characters"][number],
): string {
  return character.identity_description ?? character.visual_description;
}

/** segment 文本口径（scene_description + visual_elements）：[角色锚点] 与 sheet 阈值统计同源。 */
export function segmentAnchorText(
  segment: StoryboardPlan["segments"][number],
): string {
  return [segment.scene_description, ...segment.visual_elements].join(" ");
}

/**
 * label 命中判定：**[角色锚点] 与 sheet 出场阈值统计的唯一定义处**。
 * 两处若各写一套字符串匹配，会随改动漂移（2026-09-18 设计 §3.2 明确要求复用）。
 */
export function characterHitsSegmentText(
  character: { label: string },
  segmentText: string,
): boolean {
  return segmentText.includes(character.label);
}

export function charactersHittingSegmentText(
  characters: AssetPlan["art_bible"]["characters"],
  segmentText: string,
): AssetPlan["art_bible"]["characters"] {
  return characters.filter((character) =>
    characterHitsSegmentText(character, segmentText),
  );
}

/**
 * sheet 的 prompt_draft：角色稳定身份（或旧描述回退）+ 冻结项目画风 + 时代与定妆布局，
 * 全部来自确定性模板（无 LLM 调用）。
 */
export function buildCharacterSheetPrompt(input: {
  label: string;
  identityDescription: string;
  eraStyle: string;
  visualTone: string;
  globalPromptPrefix: string;
}): string {
  const era = input.eraStyle.trim() || "当前项目朝代";
  return [
    `角色定妆参考图「${input.label}」：${input.identityDescription}`,
    `【项目画风】${input.visualTone}；${input.globalPromptPrefix}`,
    `【定妆图布局】${CHARACTER_SHEET_LAYOUT}。`,
    `【视觉约束】${CHARACTER_SHEET_ERA_CONSTRAINT.replace("%s", era)}。`,
  ].join("\n");
}

export function enrichAssetVisualPrompt(
  input: AssetVisualPromptEnrichmentInput,
): string | null {
  let prompt = input.promptDraft;
  if (!prompt) return prompt;

  if (input.taskType === "image_still") {
    const segment = input.storyboardSegments.find(
      (candidate) => candidate.segment_id === input.sourceSegmentId,
    );
    if (segment) {
      const anchors = charactersHittingSegmentText(
        input.artBible.characters,
        segmentAnchorText(segment),
      )
        .map((character) => `${character.label}：${characterIdentityDescription(character)}`)
        .join("；");
      if (anchors.length > 0) prompt = `${prompt}\n[角色锚点] ${anchors}`;
    }
  }

  if (input.taskType !== "image_still" && input.taskType !== "video_clip") {
    return prompt;
  }
  if (/写实历史质感，建筑、发型、服饰、器物、文字形制必须符合/.test(prompt)) {
    return prompt;
  }
  const era = input.artBible.era_style.trim() || "当前项目朝代";
  return `${prompt}\n【视觉约束】${VISUAL_CONSTRAINT_BASE.replace("%s", era)}。`;
}
