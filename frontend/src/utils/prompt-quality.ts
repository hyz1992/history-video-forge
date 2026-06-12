/**
 * Lightweight prompt quality checker for image / video prompts.
 * Does NOT use hardcoded keyword blacklists — checks structural dimensions.
 */

export interface PromptQualityResult {
  score: "strong" | "adequate" | "weak";
  checks: PromptQualityCheck[];
}

export interface PromptQualityCheck {
  dimension: string;
  label: string;
  passed: boolean;
}

export function checkPromptQuality(
  promptDraft: string | null | undefined,
  taskType: "image_still" | "video_clip",
): PromptQualityResult {
  const text = (promptDraft ?? "").trim();
  const checks: PromptQualityCheck[] = [];

  // Structural dimensions — all are advisory, none are hard fail.
  const hasScene = /场景|背景|环境|地点|宫殿|城墙|城门|朝堂|战场|原野|大殿/.test(text);
  checks.push({ dimension: "scene", label: "场景/地点", passed: hasScene || text.length > 40 });

  const hasSubject = /人物|角色|晏子|楚王|项羽|刘邦|士兵|将领|使臣/.test(text) || text.length > 30;
  checks.push({ dimension: "subject", label: "主体/角色", passed: hasSubject });

  const hasEra = /春秋|战国|秦汉|先秦|楚国|齐国|秦朝|汉代|唐代|宋代|明代|清代/.test(text) ||
    /古风|历史|正剧|厚重|史诗|古典/.test(text) ||
    /服饰|深衣|甲胄|长袍|高冠|宽袍|旌旗|竹简|青铜|夯土|戈矛|战车/.test(text);
  checks.push({ dimension: "era", label: "时代/服饰/器物", passed: hasEra });

  const hasCamera = /远景|近景|特写|中景|广角|仰拍|俯拍|推进|拉远|平移|构图|景别/.test(text);
  checks.push({ dimension: "camera", label: "镜头运动", passed: hasCamera || taskType === "image_still" });

  const hasMood = /氛围|情绪|压迫|肃杀|庄严|紧张|悲壮|压抑|沉重|宏伟|静谧|光影|色调/.test(text);
  checks.push({ dimension: "mood", label: "情绪/氛围", passed: hasMood || text.length > 50 });

  const hasNegative = /无|不包含|避免|禁止|严禁|不得/.test(text);
  checks.push({ dimension: "negative", label: "负面约束", passed: hasNegative });

  // Video-specific checks
  if (taskType === "video_clip") {
    const hasMotion = /动作|运动|移动|走动|奔跑|推进|挥动|转头|起身|迈步|冲入|转身|举起/.test(text);
    checks.push({ dimension: "motion", label: "主体动作", passed: hasMotion || text.length > 60 });

    const hasEnvChange = /变化|光线|渐变|过渡|切换|交替|转变/.test(text);
    checks.push({ dimension: "env_change", label: "环境变化", passed: hasEnvChange || text.length > 50 });
  }

  const passCount = checks.filter(c => c.passed).length;
  const score: PromptQualityResult["score"] =
    passCount >= checks.length - 1 ? "strong" :
    passCount >= Math.ceil(checks.length / 2) ? "adequate" : "weak";

  return { score, checks };
}
