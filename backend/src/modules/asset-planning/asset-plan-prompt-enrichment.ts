import type { AssetPlan, StoryboardPlan } from "../../../../shared/src/index.js";

export interface AssetVisualPromptEnrichmentInput {
  taskType: "image_still" | "video_clip" | "render_motion_cue" | "sfx_cue" | "bgm_cue";
  promptDraft: string | null;
  sourceSegmentId: string;
  storyboardSegments: StoryboardPlan["segments"];
  artBible: AssetPlan["art_bible"];
}

const VISUAL_CONSTRAINT_BASE =
  "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合%s背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感";

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
      const segmentText = [segment.scene_description, ...segment.visual_elements].join(" ");
      const anchors = input.artBible.characters
        .filter((character) => segmentText.includes(character.label))
        .map((character) => `${character.label}：${character.visual_description}`)
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
