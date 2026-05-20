import { describe, expect, it } from "vitest";

import {
  readBgmCueParams,
  readSfxCueParams,
} from "../../../backend/src/modules/assets/audio-cue-params.js";

describe("audio cue params", () => {
  it("reads BGM cue parameters with conservative defaults", () => {
    expect(
      readBgmCueParams({
        required_tags: ["drum", "", 7],
        mood_tags: ["tense"],
        volume: 2,
        fade_in_sec: -1,
        fade_out_sec: 0.5,
        scope: "segment_span",
        segment_ids: ["seg_1", "seg_2"],
        library_item_id: "bgm_001",
        selection_label: "war drums",
      }),
    ).toEqual({
      requiredTags: ["drum"],
      moodTags: ["tense"],
      volume: 1,
      fadeInSec: 0,
      fadeOutSec: 0.5,
      scope: "segment_span",
      segmentIds: ["seg_1", "seg_2"],
      libraryItemId: "bgm_001",
      selectionLabel: "war drums",
    });
  });

  it("uses safe BGM defaults when parameters are missing or invalid", () => {
    expect(
      readBgmCueParams({
        required_tags: [],
        mood_tags: "tense",
        volume: Number.NaN,
        fade_in_sec: "fast",
        fade_out_sec: -2,
        scope: "scene",
        segment_ids: [],
        library_item_id: "",
        selection_label: 7,
      }),
    ).toEqual({
      requiredTags: ["background"],
      moodTags: [],
      volume: 0.3,
      fadeInSec: 0,
      fadeOutSec: 0,
      scope: "global",
      segmentIds: [],
      libraryItemId: null,
      selectionLabel: null,
    });
  });

  it("does not guess SFX tags when none are structured", () => {
    expect(readSfxCueParams({ mood_tags: ["sharp"] })).toEqual({
      requiredTags: [],
      moodTags: ["sharp"],
      libraryItemId: null,
      selectionLabel: null,
    });
  });

  it("prefers explicit sfx_tags over generic required_tags", () => {
    expect(
      readSfxCueParams({
        sfx_tags: ["impact", "", 3],
        required_tags: ["fallback"],
        mood_tags: ["sharp"],
        library_item_id: "sfx_001",
        selection_label: "blade hit",
      }),
    ).toEqual({
      requiredTags: ["impact"],
      moodTags: ["sharp"],
      libraryItemId: "sfx_001",
      selectionLabel: "blade hit",
    });
  });
});
