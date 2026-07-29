import { describe, expect, it } from "vitest";

import {
  TOPIC_CANDIDATE_LIBRARY_ROOT_DIR,
  buildTopicCandidateLibraryDirectory,
  buildTopicCandidateLibrarySlugs,
} from "../../../backend/src/modules/topic/topic-candidate-library.path.js";

describe("topic candidate library path", () => {
  it("maps the same seed family and seed profile to the same directory", () => {
    const first = buildTopicCandidateLibraryDirectory({
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
    });
    const second = buildTopicCandidateLibraryDirectory({
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
    });

    expect(first).toBe(second);
    expect(first).toBe(
      "storage/topic-candidate-library/history-diplomacy/han-court-showdown",
    );
    expect(first.startsWith(`${TOPIC_CANDIDATE_LIBRARY_ROOT_DIR}/`)).toBe(true);
  });

  it("can resolve the same seed directory under a custom rootDir", () => {
    const directory = buildTopicCandidateLibraryDirectory({
      rootDir: "D:/tmp/topic-candidate-library-runtime-123",
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
    });

    expect(directory).toBe(
      "D:\\tmp\\topic-candidate-library-runtime-123\\storage\\topic-candidate-library\\history-diplomacy\\han-court-showdown",
    );
  });

  it("generates readable ASCII-safe slugs from explicit seed fields", () => {
    const slugs = buildTopicCandidateLibrarySlugs({
      seedFamily: "History / Diplomacy",
      seedProfile: "Han Court Showdown #1",
    });

    expect(slugs).toEqual({
      seedFamilySlug: "history-diplomacy",
      seedProfileSlug: "han-court-showdown-1",
    });
    expect(/^[a-z0-9-]+$/u.test(slugs.seedFamilySlug)).toBe(true);
    expect(/^[a-z0-9-]+$/u.test(slugs.seedProfileSlug)).toBe(true);
  });

  it("does not depend on title-like content outside seed family/profile", () => {
    const first = buildTopicCandidateLibraryDirectory({
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
      title: "晏子使楚：出使楚国的压场对顶",
    });
    const second = buildTopicCandidateLibraryDirectory({
      seedFamily: "History Diplomacy",
      seedProfile: "Han Court Showdown",
      title: "张巡守城：死守孤城的极限反压",
    });

    expect(first).toBe(second);
  });

  it("does not collapse pure Chinese seed fields to unknown", () => {
    const slugs = buildTopicCandidateLibrarySlugs({
      seedFamily: "中国古代重大历史事件",
      seedProfile: "中国古代重大历史事件",
    });

    expect(slugs.seedFamilySlug).not.toBe("unknown");
    expect(slugs.seedProfileSlug).not.toBe("unknown");
    expect(slugs.seedFamilySlug).toBe(slugs.seedProfileSlug);
    expect(/^[a-z0-9-]+$/u.test(slugs.seedFamilySlug)).toBe(true);
  });

  it("produces short slugs even for very long Chinese sentences (Windows MAX_PATH safety)", () => {
    // 真实事故场景：S2-5 事件库入口允许"事件 + 自定义 angle"完整中文句子。
    // 例："从狄仁杰的立场看他如何以姑侄与母子的亲疏对比"（27 个汉字）。
    // 旧实现用 Buffer.from(segment).toString("hex") 会让单层目录名达 162 字符，
    // 叠加绝对路径在 Windows 上超 MAX_PATH=260 触发 ENOENT。
    const longChineseAngle =
      "从狄仁杰的立场看他如何以姑侄与母子的亲疏对比";
    const slugs = buildTopicCandidateLibrarySlugs({
      seedFamily: "狄仁杰劝武则天立嗣",
      seedProfile: longChineseAngle,
    });

    // 单层 slug 必须 ≤ 16 字符（前缀 u8- 3 字符 + 12 hex），保证 Windows 安全。
    expect(slugs.seedFamilySlug.length).toBeLessThanOrEqual(16);
    expect(slugs.seedProfileSlug.length).toBeLessThanOrEqual(16);
    expect(slugs.seedFamilySlug.startsWith("u8-")).toBe(true);
    expect(slugs.seedProfileSlug.startsWith("u8-")).toBe(true);
    expect(/^[a-z0-9-]+$/u.test(slugs.seedFamilySlug)).toBe(true);
    expect(/^[a-z0-9-]+$/u.test(slugs.seedProfileSlug)).toBe(true);
  });

  it("keeps the same Chinese sentence mapped to the same slug (deterministic)", () => {
    const angle = "巧妙劝说武则天归政李氏";
    const first = buildTopicCandidateLibrarySlugs({
      seedFamily: "event",
      seedProfile: angle,
    });
    const second = buildTopicCandidateLibrarySlugs({
      seedFamily: "event",
      seedProfile: angle,
    });

    expect(first.seedProfileSlug).toBe(second.seedProfileSlug);
  });

  it("keeps different Chinese sentences mapped to different slugs (low collision)", () => {
    const a = buildTopicCandidateLibrarySlugs({
      seedFamily: "x",
      seedProfile: "从狄仁杰的立场看他如何以姑侄与母子的亲疏对比",
    });
    const b = buildTopicCandidateLibrarySlugs({
      seedFamily: "x",
      seedProfile: "巧妙劝说武则天归政李氏",
    });

    expect(a.seedProfileSlug).not.toBe(b.seedProfileSlug);
  });

  it("returns unknown for empty / whitespace-only input", () => {
    const slugs = buildTopicCandidateLibrarySlugs({
      seedFamily: "   ",
      seedProfile: "",
    });

    expect(slugs.seedFamilySlug).toBe("unknown");
    expect(slugs.seedProfileSlug).toBe("unknown");
  });
});
