/**
 * Derive hashtags from upstream structured fields without LLM.
 *
 * Inputs: TopicPackage (family_label, scope_label, title), ArtBible (era_style),
 * Storyboard (narrative_role distribution)
 *
 * Strategy: rule-based keyword extraction + normalization.
 */
export interface HashtagDerivationInput {
  familyLabel: string;
  scopeLabel: string;
  topicTitle: string;
  eraStyle?: string;
  narrativeRoles?: string[];
}

/**
 * Trim common era/dynasty suffixes to extract the core period name.
 */
function extractEraKeyword(scopeLabel: string): string {
  const suffixes = ["初期", "中期", "末期", "晚期", "时期", "时代", "朝代", "年间"];
  let result = scopeLabel;
  for (const suffix of suffixes) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result || scopeLabel;
}

/**
 * Extract meaningful keywords from era_style string.
 * era_style is typically a dense descriptor like "明末清初江南历史正剧".
 */
function extractEraStyleKeywords(eraStyle: string): string[] {
  // Split on common delimiters and filter short fragments
  const parts = eraStyle
    .replace(/[,，、\s/]+/g, " ")
    .split(" ")
    .filter(Boolean);

  if (parts.length === 0) return [];

  // If only one part, try to break it into meaningful chunks
  if (parts.length === 1) {
    const text = parts[0];
    const keywords: string[] = [];
    // Extract known dynasty/period names
    const dynastyPattern = /西周|东周|南北朝|十六国|五代|十国|三国|春秋|战国|北宋|南宋|[夏商周秦汉魏晋隋唐宋元明清]|辽|金|西夏|大理|匈奴|突厥|吐蕃/g;
    const matches = text.match(dynastyPattern);
    if (matches) keywords.push(...matches);
    return [...new Set(keywords)];
  }

  return parts.filter((p) => p.length >= 2 && p.length <= 8);
}

/**
 * Count narrative_role occurrences in storyboard segments.
 */
function extractNarrativeRoleKeywords(roles: string[]): string[] {
  const roleMap: Record<string, string> = {
    opening: "开场",
    setup: "故事铺垫",
    twist: "转折",
    climax: "高潮",
    resolution: "结局",
    ending: "结尾",
  };

  const uniqueRoles = new Set(roles);
  return [...uniqueRoles]
    .filter((r) => roleMap[r])
    .map((r) => roleMap[r]);
}

export function deriveHashtags(input: HashtagDerivationInput): string[] {
  const tags = new Set<string>();

  // 1. Base tag
  tags.add("历史");

  // 2. Era from scope_label
  const era = extractEraKeyword(input.scopeLabel);
  if (era && era.length >= 2) tags.add(era);

  // 3. Family label directly
  if (input.familyLabel && input.familyLabel.length >= 2) {
    tags.add(input.familyLabel);
  }

  // 4. Topic title if short enough (specific event/person name)
  const title = input.topicTitle.trim();
  if (title.length >= 2 && title.length <= 15) {
    tags.add(title);
  }

  // 5. Era style keywords
  if (input.eraStyle) {
    for (const kw of extractEraStyleKeywords(input.eraStyle)) {
      if (kw.length >= 1) tags.add(kw);
    }
  }

  // 6. Narrative role hints (limited)
  if (input.narrativeRoles && input.narrativeRoles.length > 0) {
    const roleKeywords = extractNarrativeRoleKeywords(input.narrativeRoles);
    for (const rk of roleKeywords.slice(0, 2)) {
      tags.add(rk);
    }
  }

  // 7. Generic closer
  tags.add("历史故事");

  // Deduplicate and limit
  return [...tags].slice(0, 10);
}
