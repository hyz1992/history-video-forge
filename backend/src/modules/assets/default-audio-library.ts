import type { MediaLibraryItem } from "../../../../shared/src/index.js";

const IMPORTED_AT = "2026-05-20T00:00:00.000Z";

function cc0Item(input: {
  library_item_id: string;
  type: "bgm" | "sfx";
  file_uri: string;
  mime_type: string;
  duration_sec: number;
  loopable: boolean;
  tags: string[];
  mood_tags: string[];
  source_url: string;
  file_hash: string;
}): MediaLibraryItem {
  return {
    library_item_id: input.library_item_id,
    type: input.type,
    file_uri: input.file_uri,
    mime_type: input.mime_type,
    duration_sec: input.duration_sec,
    loopable: input.loopable,
    tags: input.tags,
    mood_tags: input.mood_tags,
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
      source_url: input.source_url,
    },
    file_hash: input.file_hash,
    imported_at: IMPORTED_AT,
    approved_for_use: true,
  };
}

// These seed entries are metadata-first. When real audio files are downloaded,
// replace each sha256:pending-* value with the file's real SHA-256 hash.
export const DEFAULT_AUDIO_LIBRARY_ITEMS: MediaLibraryItem[] = [
  cc0Item({
    library_item_id: "bgm_tense_dark_drone_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_tense_dark_drone_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "drone"],
    mood_tags: ["tense", "dark", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-tense-dark-drone-001",
  }),
  cc0Item({
    library_item_id: "bgm_solemn_historical_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_solemn_historical_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "orchestral"],
    mood_tags: ["solemn", "historical", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-solemn-historical-001",
  }),
  cc0Item({
    library_item_id: "bgm_mysterious_night_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_mysterious_night_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "ambient"],
    mood_tags: ["mysterious", "night", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-mysterious-night-001",
  }),
  cc0Item({
    library_item_id: "bgm_urgent_battle_percussion_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_urgent_battle_percussion_001.wav",
    mime_type: "audio/wav",
    duration_sec: 30,
    loopable: true,
    tags: ["background", "percussion"],
    mood_tags: ["urgent", "battle", "medium"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-urgent-battle-percussion-001",
  }),
  cc0Item({
    library_item_id: "bgm_reflective_soft_001",
    type: "bgm",
    file_uri: "library://audio/bgm/bgm_reflective_soft_001.wav",
    mime_type: "audio/wav",
    duration_sec: 45,
    loopable: true,
    tags: ["background", "calm"],
    mood_tags: ["reflective", "soft", "slow"],
    source_url: "https://opengameart.org/content/cc0-music-0",
    file_hash: "sha256:pending-bgm-reflective-soft-001",
  }),
  ...[
    {
      id: "sfx_heartbeat_tense_001",
      tag: "heartbeat",
      moods: ["tense", "close"],
      durationSec: 2,
      loopable: false,
    },
    {
      id: "sfx_footstep_indoor_001",
      tag: "footstep",
      moods: ["quiet", "indoor"],
      durationSec: 1,
      loopable: false,
    },
    {
      id: "sfx_door_heavy_001",
      tag: "door",
      moods: ["heavy", "indoor"],
      durationSec: 2,
      loopable: false,
    },
    {
      id: "sfx_hit_sharp_001",
      tag: "hit",
      moods: ["sharp", "impact"],
      durationSec: 1,
      loopable: false,
    },
    {
      id: "sfx_whoosh_transition_001",
      tag: "whoosh",
      moods: ["transition", "fast"],
      durationSec: 1,
      loopable: false,
    },
    {
      id: "sfx_crowd_court_low_001",
      tag: "crowd",
      moods: ["court", "low"],
      durationSec: 4,
      loopable: false,
    },
    {
      id: "sfx_drum_solemn_001",
      tag: "drum",
      moods: ["solemn", "impact"],
      durationSec: 2,
      loopable: false,
    },
    {
      id: "sfx_sword_metal_001",
      tag: "sword",
      moods: ["metal", "sharp"],
      durationSec: 1,
      loopable: false,
    },
    {
      id: "sfx_paper_soft_001",
      tag: "paper",
      moods: ["soft", "indoor"],
      durationSec: 1,
      loopable: false,
    },
    {
      id: "sfx_ambience_night_001",
      tag: "ambience",
      moods: ["night", "outdoor"],
      durationSec: 8,
      loopable: true,
    },
  ].map((item) =>
    cc0Item({
      library_item_id: item.id,
      type: "sfx",
      file_uri: `library://audio/sfx/${item.id}.wav`,
      mime_type: "audio/wav",
      duration_sec: item.durationSec,
      loopable: item.loopable,
      tags: [item.tag],
      mood_tags: item.moods,
      source_url: "https://opengameart.org/content/soundfx-library-cc0",
      file_hash: `sha256:pending-${item.id}`,
    }),
  ),
];
