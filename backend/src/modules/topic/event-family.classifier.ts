const PRIMARY_FAMILIES = [
  "外交压场型",
  "战场翻盘型",
  "刺杀政变型",
  "权谋决断型",
  "变法治术型",
  "君臣博弈型",
  "忠义抉择型",
  "通用安全槽位",
] as const;

export type TopicFamily = (typeof PRIMARY_FAMILIES)[number];

export interface ClassifyEventFamilyInput {
  tags?: string[];
  familyHint?: string;
}

export function classifyEventFamily(
  input: ClassifyEventFamilyInput,
): TopicFamily {
  if (
    input.familyHint &&
    PRIMARY_FAMILIES.includes(input.familyHint as TopicFamily)
  ) {
    return input.familyHint as TopicFamily;
  }

  const tags = new Set(input.tags ?? []);

  if (tags.has("diplomacy") || tags.has("court") || tags.has("humiliation")) {
    return "外交压场型";
  }

  if (tags.has("battle") || tags.has("campaign")) {
    return "战场翻盘型";
  }

  if (tags.has("assassination") || tags.has("coup")) {
    return "刺杀政变型";
  }

  if (tags.has("reform") || tags.has("strategy")) {
    return "变法治术型";
  }

  if (tags.has("decision") || tags.has("power")) {
    return "权谋决断型";
  }

  if (tags.has("loyalty") || tags.has("sacrifice")) {
    return "忠义抉择型";
  }

  return "通用安全槽位";
}
