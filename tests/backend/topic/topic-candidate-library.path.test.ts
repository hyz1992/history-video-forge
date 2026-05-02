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
});
