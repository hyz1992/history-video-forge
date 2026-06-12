/**
 * Lightweight art-quality risk hints for image / video prompts.
 * Does NOT claim to judge aesthetic quality — only flags structural risks
 * that historically lead to visual issues (era mismatch, modern objects, etc.).
 *
 * All rules are regex-based and explicitly documented.  No keyword blacklists.
 */

export interface ArtRiskHint {
  code: string;
  label: string;
  risk: string;
  suggestion: string;
  triggered: boolean;
}

export function checkArtRisks(
  promptDraft: string | null | undefined,
  taskType: "image_still" | "video_clip",
): ArtRiskHint[] {
  const text = (promptDraft ?? "").trim();
  const hints: ArtRiskHint[] = [];

  // ── Structural completeness ──────────────────────────────────────
  const hasEraDetail = /春秋|战国|秦汉|先秦|楚国|齐国|秦朝|汉代|唐代|宋代|明代|清代/.test(text) ||
    /古风|历史|正剧|史诗|厚重|古典/.test(text) ||
    /服饰|深衣|甲胄|长袍|高冠|宽袍|旌旗|竹简|青铜|夯土|戈矛|战车|玉笏/.test(text);
  hints.push({
    code: "era_detail",
    label: "时代质感",
    risk: "缺乏时代/服饰/器物约束，图片可能偏向通用古风而非具体朝代质感",
    suggestion: "补充朝代、服饰（深衣/甲胄）、器物（青铜/竹简）、建筑（夯土/木构）等具体元素",
    triggered: !hasEraDetail,
  });

  const hasSceneSpace = /场景|背景|环境|地点|宫殿|城墙|城门|朝堂|战场|原野|大殿|广场|城外/.test(text) ||
    /城门|城楼|城墙|朝堂|宫殿|大殿/.test(text);
  hints.push({
    code: "scene_space",
    label: "场景空间",
    risk: "场景地点不明确，可能生成模糊的泛化背景",
    suggestion: "补充具体地点描述，如'楚国城门外的夯土广场'而非'室外'",
    triggered: !hasSceneSpace && text.length < 80,
  });

  // ── Character risk ───────────────────────────────────────────────
  const hasCharDetail = /身形|脊背|挺直|面容|目光|眼神|神态|姿态|服饰|深衣|长袍|甲胄|高冠/.test(text);
  hints.push({
    code: "character_detail",
    label: "人物外观",
    risk: "人物外观描述过于笼统，跨镜头一致性难以保证",
    suggestion: "补充身形（矮小/魁梧）、姿态（挺直/俯视）、服饰（深衣/甲胄）、神态等具体描述",
    triggered: text.length > 30 && !hasCharDetail,
  });

  // ── Anachronism risk ─────────────────────────────────────────────
  const hasModernRisk = /现代|当代|西装|手机|汽车|电线|路灯|霓虹|沥青|玻璃幕墙|广告牌/.test(text);
  const hasFantasyRisk = /动漫|奇幻|魔法|游戏|CG|3D渲染|科幻|机甲|赛博/.test(text);
  const hasNegativeGuard = /无现代|不包含现代|避免现代|严禁现代|禁止现代|无动漫|不包含动漫/.test(text);
  hints.push({
    code: "anachronism",
    label: "时代穿帮风险",
    risk: hasModernRisk
      ? "提示词包含现代词汇"
      : hasFantasyRisk
        ? "提示词包含动漫/奇幻/游戏风格词汇"
        : "未明确排除现代元素、动漫风格或奇幻特效",
    suggestion: "在负面约束中加入'现代物品、动漫风、奇幻特效、游戏质感'等排除项",
    triggered: hasModernRisk || hasFantasyRisk || !hasNegativeGuard,
  });

  // ── Consistency risk (multiple characters) ────────────────────────
  const namedChars = text.match(/晏子|楚王|项羽|刘邦|士兵|将领|使臣|侍卫|群臣/g);
  hints.push({
    code: "character_consistency",
    label: "角色一致性",
    risk: namedChars && namedChars.length >= 2
      ? `涉及 ${namedChars.length} 个角色，跨镜头外观一致性依赖独立提示词`
      : "缺少明确角色名，跨镜头可能生成不一致的人物外观",
    suggestion: "确保每个角色的 visual_description 在各镜头中保持一致，引用 ArtBible 角色锚点",
    triggered: text.length > 40,
  });

  // ── Composition / lighting ────────────────────────────────────────
  const hasComposition = /远景|近景|特写|中景|广角|仰拍|俯拍|构图|景别|光影|逆光|侧光|暖光|冷光/.test(text);
  hints.push({
    code: "composition",
    label: "构图与光线",
    risk: "缺少构图和光影描述，图片可能平淡或构图不当",
    suggestion: "补充景别（远景/特写）、角度（仰拍/俯拍）、光线方向与色调",
    triggered: !hasComposition,
  });

  // ── Video-specific ────────────────────────────────────────────────
  if (taskType === "video_clip") {
    const hasMotionDetail = /动作|运动|移动|走动|奔跑|推进|挥动|转头|起身|迈步|冲入|转身|举起|走入|离去/.test(text);
    hints.push({
      code: "motion_detail",
      label: "主体动作",
      risk: "视频提示词缺少主体动作描述，可能生成静态或缓慢画面",
      suggestion: "补充具体动作路径，如'从左侧走入画面，在中央停下，转身面对镜头'",
      triggered: !hasMotionDetail,
    });
  }

  return hints;
}
