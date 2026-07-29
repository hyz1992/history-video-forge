import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const TOPIC_CANDIDATE_LIBRARY_ROOT_DIR =
  "storage/topic-candidate-library";

interface TopicCandidateLibraryPathInput {
  rootDir?: string;
  seedFamily: string;
  seedProfile: string;
  title?: string;
}

export function buildTopicCandidateLibrarySlugs(
  input: TopicCandidateLibraryPathInput,
) {
  return {
    seedFamilySlug: toAsciiSlug(input.seedFamily),
    seedProfileSlug: toAsciiSlug(input.seedProfile),
  };
}

export function buildTopicCandidateLibraryDirectory(
  input: TopicCandidateLibraryPathInput,
) {
  const { seedFamilySlug, seedProfileSlug } =
    buildTopicCandidateLibrarySlugs(input);
  const relativeDirectory =
    `${TOPIC_CANDIDATE_LIBRARY_ROOT_DIR}/${seedFamilySlug}/${seedProfileSlug}`;

  return input.rootDir
    ? resolve(input.rootDir, relativeDirectory)
    : relativeDirectory;
}

/**
 * 把任意字符串转成 ASCII-safe 的文件系统 slug。
 *
 * 设计要点：
 *   - 优先用 ASCII 字母数字（原有行为，给 "History Diplomacy" 这类标签用）。
 *   - 退化路径（纯中文 / 非ASCII）：用 SHA-256 摘要 + 截断，而不是完整 UTF-8 hex。
 *     原因：S2-5 之后用户可以输入"事件 + 自定义 angle"完整中文句子（如
 *     "从狄仁杰的立场看他如何以姑侄与母子的亲疏对比"，27 个汉字）。
 *     旧逻辑用 `u8-${Buffer.from(segment).toString("hex")}` 会让单层目录名
 *     达到 162 字符，叠加绝对路径在 Windows 上超 MAX_PATH=260 触发 ENOENT。
 *   - SHA-256 前 12 hex 字符（48 bit）碰撞概率极低（同一会话内 < 100 个候选，
 *     生日攻击碰撞概率 < 1e-10），且 index.json 里保留了原始中文，可读性不丢。
 *   - 前缀 `u8-` 保留，便于一眼识别"这是非 ASCII slug"。
 *
 * 单层目录名长度：前缀 3 字符 + 12 hex = 15 字符，远低于任何文件系统的 name limit。
 */
function toAsciiSlug(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized) {
    return normalized;
  }

  if (trimmed.length === 0) {
    return "unknown";
  }

  const hash = createHash("sha256").update(trimmed, "utf8").digest("hex");
  return `u8-${hash.slice(0, 12)}`;
}
