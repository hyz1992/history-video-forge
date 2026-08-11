# TTS Duration and Subtitle Timing Design

Date: 2026-05-19

Status: draft for implementation review

## 1. Goal

Close the P0 gap around TTS chunking, real audio duration, and subtitle timing so `assets -> compose -> renderer` can consume timing data that is closer to the generated narration, while keeping the existing upstream narrative chain frozen.

This design follows the completed TTS / Voice Assets and voice profile persistence work. It does not redesign voice matching, provider voice creation, storyboard, compose semantics, renderer/export, BGM/SFX, or any UI.

## 2. Current State

Current assets behavior:

- `AssetPlan.tts_plan.chunks` is the only TTS chunk source.
- `buildInitialAssetManifest()` creates placeholder `tts_chunk_audio` artifacts and `audio_summary.tts_chunk_routes` from those chunks.
- Fake TTS and DashScope TTS both currently write `metadata.duration_sec` from `estimated_duration_sec`.
- DashScope TTS downloads audio bytes but does not inspect them for duration.
- Local subtitle generation reads completed TTS chunk artifacts and creates SRT/VTT cues using chunk `duration_sec`.
- Compose already prefers merged TTS artifact duration and chunk artifact durations, but those durations are still often estimates.

The next improvement should therefore focus on assets-owned timing data, not on frozen upstream story/script semantics.

## 3. Decisions

### 3.1 Chunking Boundary

Do not mutate stored `AssetPlanRecord.planJson` in this task. Add an assets-local execution normalizer that derives a normalized TTS plan and explicit TTS chunk routes for manifest build and provider execution.

Rules:

- Preserve original chunk order.
- Derive parent segment ownership before splitting, using the current positional rule: original `tts_plan.chunks[i]` maps to `segmentIds[i]` when present, otherwise to an empty segment list and a mismatch note.
- Child chunks inherit the full parent `segment_ids` array. If `chunk_1` maps to `seg_A`, then `chunk_1_part_1`, `chunk_1_part_2`, and `chunk_1_part_3` all map to `seg_A`.
- Split long chunks by Chinese/English sentence punctuation first.
- If a sentence still exceeds the configured maximum, split by character window.
- Generate stable derived ids: `<original_chunk_id>_part_<n>`.
- Distribute estimated duration proportionally by text length until true audio duration is known.

Artifact ids should keep the existing convention `artifact_tts_chunk_${chunk_id}`. A derived chunk such as `chunk_1_part_1` therefore produces `artifact_tts_chunk_chunk_1_part_1`. This is slightly repetitive but keeps compatibility with current internal id generation and avoids introducing dotted ids or path-like ids in this task.

The first implementation should use conservative defaults:

- `max_chars_per_chunk`: 180
- `target_chars_per_chunk`: 120
- minimum derived duration: 0.5 seconds

The 180 character limit is intentionally conservative for Chinese narration: it keeps most chunks roughly in the tens-of-seconds range at common spoken pacing, avoids very large provider requests, and still gives the subtitle provider coarse but usable cue boundaries. It is not a content-quality rule.

The normalizer is local deterministic logic. It must not call an LLM and must not alter script text beyond trimming whitespace around split boundaries.

`buildInitialAssetManifest()` must stop assuming normalized chunk index equals segment index. It should accept explicit normalized `tts_chunk_routes` from the normalizer, or an equivalent input shape, and use those routes when creating placeholder TTS artifacts and `audio_summary.tts_chunk_routes`.

### 3.2 Timing Source Vocabulary

Current shared metadata allows `timing_source` values `provider`, `estimated`, and `aligned`. This task should introduce explicit values while keeping old values compatible during transition:

- `estimated`: duration or cue timing came from upstream estimate.
- `audio_probe`: duration came from local inspection of downloaded/generated audio bytes.
- `provider_timestamp`: timing came from provider-returned timestamps.
- `forced_alignment`: timing came from a local or external alignment engine.
- `mixed`: subtitle or merged timing combines source chunks with different timing sources.

Old values `provider` and `aligned` may remain accepted until all existing tests and fixtures are migrated.

### 3.3 Real TTS Duration

First implementation should measure local audio duration after download/write, without adding dependencies.

Supported in this task:

- WAV duration from RIFF/WAVE headers.
- PCM duration when `sampleRate`, `bytesPerSample`, and `channels` are known. The helper may default to 16-bit mono PCM (`bytesPerSample=2`, `channels=1`) only when the caller explicitly identifies the format as PCM.

Fallback:

- MP3/FLAC/unknown formats keep `estimated_duration_sec` and `timing_source=estimated`.
- No default real DashScope calls are run; mocked tests should use synthetic WAV bytes.

DashScope TTS should:

- write each chunk artifact with measured duration when available;
- carry each chunk's `estimated_duration_sec` from submit-time raw chunk data into download-time artifact metadata;
- write merged artifact duration as the sum of final chunk durations;
- set `timing_source=audio_probe` only when all merged/chunk durations came from audio probing;
- preserve provider voice metadata already added by prior work.

Fake TTS may remain estimated. It should keep `timing_source=estimated`.

### 3.4 Subtitle Timing

Local subtitle generation should continue to run after TTS artifacts exist. Its first improved timing source is the completed TTS chunk artifacts:

- cue start/end times are derived from chunk durations;
- subtitle metadata records `timing_source`;
- subtitle metadata records `duration_sec`;
- subtitle metadata records source TTS chunk artifact ids.
- if source chunks have a mixture of timing sources, subtitle metadata uses `timing_source=mixed` rather than silently pretending all cues are estimated or probed.

This task does not implement word-level forced alignment. It defines the schema and provider boundary so a later task can replace chunk-level cues with provider timestamps or forced alignment cues.

### 3.5 Compose Consumption

Compose already derives segment timing from TTS chunk artifact durations and falls back to total duration when chunk coverage is incomplete. This task should add regression coverage that proves:

- chunk durations from real/probed TTS artifacts drive segment timings;
- multiple TTS chunk routes pointing to the same segment are accumulated rather than overwritten;
- subtitle track duration follows the same total narration duration;
- fallback notes remain only for incomplete chunk coverage.

No renderer-side timing logic is added in this task.

## 4. Data Contract Changes

Shared `AssetArtifact` metadata should be extended, not replaced.

TTS chunk metadata:

- `duration_sec`: final chunk duration; true duration when available.
- `estimated_duration_sec`: optional original estimate.
- `duration_source`: optional alias for new consumers; same vocabulary as timing source.
- `timing_source`: accepts `estimated`, `audio_probe`, `provider_timestamp`, `forced_alignment`, `mixed`, plus legacy `provider` and `aligned`.

TTS merged metadata:

- same `duration_sec`, `duration_source`, and `timing_source` policy.

Subtitle metadata:

- `format`
- `source_tts_artifact_id`
- `source_tts_chunk_artifact_ids`
- `caption_count`
- `duration_sec`
- `timing_source`

## 5. Error Handling

- If chunk normalization cannot produce any non-empty chunk, keep the original chunk and add a manifest note.
- If audio duration probing fails, continue with estimated duration and add artifact metadata `duration_probe_error`.
- If subtitle generation sees no completed TTS chunks, return no artifacts as today.
- If not every segment can be covered by chunk durations, compose keeps `compose_chunk_timing_fallback_used`.

## 6. Non-Goals

This design does not implement:

- real DashScope live checks by default;
- provider timestamp extraction unless a provider already returns usable timestamps;
- forced alignment engine integration;
- word-level subtitles;
- subtitle style, safe-zone, or renderer typography;
- BGM/SFX timing;
- frontend preview or editing UI;
- changes to topic/script/storyboard/asset planning semantic generation.

## 7. Acceptance

The implementation is acceptable when:

- TTS chunk normalization is deterministic and covered by unit tests.
- Long script excerpts split into stable derived chunks without changing narrative text.
- DashScope TTS mocked WAV downloads produce chunk and merged artifacts with `timing_source=audio_probe`.
- Unknown audio formats fall back to estimated duration without failing the assets run.
- Subtitle artifacts include timing metadata and derive cue boundaries from completed TTS chunks.
- Compose tests prove chunk durations drive segment timing.
- Default verification does not call real DashScope.
- `git diff --check` passes and each implementation task is committed in Chinese.
