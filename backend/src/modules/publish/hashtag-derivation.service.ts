/**
 * Derive hashtags from upstream structured fields without LLM.
 *
 * Inputs: TopicPackage (family_label, scope_label, title)
 *
 * Strategy: direct structured-field mapping. No regex parsing of free text.
 */

export interface HashtagDerivationInput {
  familyLabel: string;
  scopeLabel: string;
  topicTitle: string;
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

export function deriveHashtags(input: HashtagDerivationInput): string[] {
  const tags = new Set<string>();

  // Base tag
  tags.add("历史");

  // Era from scope_label (trim suffixes)
  const era = extractEraKeyword(input.scopeLabel);
  if (era && era.length >= 2) tags.add(era);

  // Family label directly
  if (input.familyLabel && input.familyLabel.length >= 2) {
    tags.add(input.familyLabel);
  }

  // Topic title if short enough (specific event/person name)
  const title = input.topicTitle.trim();
  if (title.length >= 2 && title.length <= 15) {
    tags.add(title);
  }

  // Generic closer
  tags.add("历史故事");

  // Deduplicate and limit
  return [...tags].slice(0, 10);
}
