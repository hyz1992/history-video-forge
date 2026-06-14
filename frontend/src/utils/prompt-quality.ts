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

  // Structural dimensions — no length-based fallback passthrough.
  const hasScene = /场景|背景|环境|地点|宫殿|城墙|城门|朝堂|战场|原野|大殿/.test(text);
  checks.push({ dimension: "scene", label: "场景/地点", passed: hasScene });

  const hasSubject = /人物|角色|晏子|楚王|项羽|刘邦|士兵|将领|使臣|身影|剪影|群臣/.test(text);
  checks.push({ dimension: "subject", label: "主体/角色", passed: hasSubject });

  const hasEra = /春秋|战国|秦汉|先秦|楚国|齐国|秦朝|汉代|唐代|宋代|明代|清代/.test(text) ||
    /古风|历史|正剧|厚重|史诗|古典|china|ancient/.test(text.toLowerCase()) ||
    /服饰|深衣|甲胄|长袍|高冠|宽袍|旌旗|竹简|青铜|夯土|戈矛|战车|玉笏/.test(text);
  checks.push({ dimension: "era", label: "时代/服饰/器物", passed: hasEra });

  const hasCamera = /远景|近景|特写|中景|广角|仰拍|俯拍|推进|拉远|平移|构图|景别|wide|close|medium/.test(text);
  checks.push({ dimension: "camera", label: "镜头运动", passed: hasCamera });

  const hasMood = /氛围|情绪|压迫|肃杀|庄严|紧张|悲壮|压抑|沉重|宏伟|静谧|光影|色调|暖光|冷光|逆光|暗色/.test(text);
  checks.push({ dimension: "mood", label: "情绪/氛围", passed: hasMood });

  const hasNegative = /无|不包含|避免|禁止|严禁|不得|现代|动漫|奇幻|猎奇|血腥/.test(text);
  checks.push({ dimension: "negative", label: "负面约束", passed: hasNegative });

  // Video-specific
  if (taskType === "video_clip") {
    const hasMotion = /动作|运动|移动|走动|奔跑|推进|挥动|转头|起身|迈步|冲入|转身|举起|走入|离去/.test(text);
    checks.push({ dimension: "motion", label: "主体动作", passed: hasMotion });

    const hasEnvChange = /变化|光线|渐变|过渡|切换|交替|转变|明暗|透入|照亮|退去/.test(text);
    checks.push({ dimension: "env_change", label: "环境变化", passed: hasEnvChange });
  }

  const passCount = checks.filter(c => c.passed).length;
  const totalChecks = checks.length;
  const score: PromptQualityResult["score"] =
    passCount === totalChecks ? "strong" :
    passCount >= totalChecks - 1 ? "adequate" : "weak";

  return { score, checks };
}

// ---------------------------------------------------------------------------
// Local prompt optimizer — rule-based enhancement from art risk hints.
// Does NOT call any LLM. Only appends structured constraints when risks
// indicate missing coverage.
// ---------------------------------------------------------------------------

export interface ArtRiskHintLike {
  code: string;
  triggered: boolean;
  suggestion: string;
}

/**
 * Enhance a prompt draft based on triggered art risk hints.
 * Appends missing structural constraints (era guards, composition, etc.)
 * without duplicating existing coverage.
 */
export function optimizePromptFromRisks(
  promptDraft: string,
  risks: ArtRiskHintLike[],
): string {
  let result = promptDraft.trim();
  const triggered = risks.filter((r) => r.triggered);
  if (triggered.length === 0) return result;

  // Collect supplements, avoiding phrases already in the prompt
  const supplements: string[] = [];
  const lower = result.toLowerCase();

  function addIfNew(phrase: string) {
    if (!lower.includes(phrase.toLowerCase())) {
      supplements.push(phrase);
    }
  }

  for (const risk of triggered) {
    switch (risk.code) {
      case "anachronism":
        addIfNew("无现代物品、无现代建筑、无动漫风、无奇幻特效，写实历史质感");
        break;
      case "era_detail":
        addIfNew("明确朝代服饰（深衣/甲胄/长袍）、器物（青铜/竹简/旌旗）、建筑（夯土城墙/木构大殿）");
        break;
      case "scene_space":
        addIfNew("明确具体历史场景地点和空间纵深");
        break;
      case "character_detail":
        addIfNew("描述人物身形、姿态、服饰细节和面部神态");
        break;
      case "character_consistency":
        addIfNew("同一角色在画面中保持一致的年龄、服饰、发型和气质");
        break;
      case "composition":
        addIfNew("明确景别（远景/中景/特写）、拍摄角度和光线方向与色调");
        break;
      case "motion_detail":
        addIfNew("描述主体具体动作路径，如'从左侧走入、在中央停下、转身面对镜头'");
        break;
    }
  }

  if (supplements.length === 0) return result;

  // Check if prompt already has a negative-constraint section
  const hasNegativeBlock = /负面约束|排除项|不要出现|禁止出现/.test(result);
  if (hasNegativeBlock && supplements.some((s) => s.includes("无现代"))) {
    // Append era/anachronism guard near the negative block
    const eraGuard = supplements.find((s) => s.includes("无现代"));
    if (eraGuard) {
      result = result.replace(/(负面约束|排除项|不要出现|禁止出现)[：:][^\n]*/, `$&，${eraGuard}`);
      const idx = supplements.indexOf(eraGuard);
      if (idx >= 0) supplements.splice(idx, 1);
    }
  }

  if (supplements.length > 0) {
    result += "\n\n【补充约束】" + supplements.join("；") + "。";
  }

  return result;
}
