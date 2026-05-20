# BGM / SFX Design

Date: 2026-05-20

## Review Guide

Read these files before reviewing or implementing this design:

- `AGENTS.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/compose-stage-design.md`
- `docs/architecture/renderer-stage-design.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `shared/src/assets/media-library.schema.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `backend/src/modules/assets/media-library-selector.ts`
- `backend/src/modules/assets/assets-manifest-builder.ts`
- `backend/src/modules/assets/assets-run.service.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/render/remotion-input-builder.ts`
- `tests/backend/assets/media-library-selector.test.ts`
- `tests/backend/compose/compose-timeline-builder.test.ts`
- `tests/backend/render/remotion-input-builder.test.ts`

This document is a design, not an implementation plan. Implementation must still be split into a separate TDD implementation plan before code changes.

## Current Baseline

The pipeline already has several BGM/SFX hooks:

- `AssetPlan.tasks` supports `sfx_cue` and `bgm_cue`.
- `MediaLibraryItem` exists for `sfx` / `bgm` with license, duration, loopability, tags, mood tags, hash and approval fields.
- `selectMediaLibraryItem()` can pick an approved item by required tags, mood tag score and deterministic ID tie-break.
- `AssetManifest` already has `sfx_audio`, `sfx_selection`, `bgm_audio`, `bgm_selection`, `BgmPlacement`, `audio_summary.sfx_artifact_ids`, `audio_summary.bgm_placements`, and segment route audio references.
- `assets-run.service` can attach returned `sfx_audio` / `bgm_audio` artifacts into audio summary and segment routes.
- `compose-timeline-builder` already emits `bgm` / `sfx` tracks when concrete audio artifacts exist.
- `remotion-input-builder` and `TimelineVideo` already consume `bgm` / `sfx` audio clips when compose exposes them.

The missing part is not renderer consumption. The gap is a reliable assets-stage way to turn BGM/SFX cue tasks into approved local/fake audio artifacts with clear licensing and matching rules.

## Goals

This design adds a first BGM/SFX completion slice:

- define the durable local media library contract needed for BGM/SFX selection;
- define how `bgm_cue` and `sfx_cue` map to media library queries;
- create deterministic fake/local BGM/SFX providers that produce renderable local audio artifacts without paid provider calls;
- ensure assets execution can resolve optional BGM/SFX when matching local items exist;
- keep compose/renderer behavior aligned with existing contracts;
- document warnings and fallback behavior when optional BGM/SFX are missing.

## Non-Goals

This design does not implement:

- real paid BGM/SFX generation providers;
- web search, external music APIs, Suno-like generation, or commercial catalog integration;
- upload / replacement UI;
- media library operations UI;
- publishing, attribution rendering, or platform packaging;
- automatic aesthetic scoring or semantic sound design judgment;
- ducking, waveform analysis, loudness normalization or beat sync beyond stored metadata and fixed volumes.

## Approaches Considered

### Recommended: Local Library Selection + Fake/Local Audio Providers

Assets uses cue metadata to select approved `MediaLibraryItem` records. When a matching item exists, a local/fake provider copies or synthesizes a deterministic renderable WAV artifact and records its library origin.

Pros:

- offline and testable;
- keeps provider cost at zero;
- aligns with existing `MediaLibraryItem`, `AssetManifest`, compose and renderer contracts;
- produces actual audio files, so Remotion smoke can verify the full path.

Cons:

- the first assets are utilitarian fixtures, not production-quality music;
- library lifecycle is still minimal.

### Alternative: Selection-Only Artifacts

Assets would only create `bgm_selection` / `sfx_selection` artifacts and leave audio materialization for a later stage.

Pros:

- smallest implementation.

Cons:

- compose and renderer already require concrete `bgm_audio` / `sfx_audio` for actual playback;
- does not close the local render quality gap.

### Alternative: Real Provider First

Integrate a paid or external BGM/SFX provider immediately.

Pros:

- closer to eventual production sound.

Cons:

- introduces cost, licensing, network variability and provider-specific policy before the local contract is stable;
- violates the current backlog direction to design first and avoid real provider calls by default.

## Design Decisions

### Decision 1: BGM/SFX Remain Assets-Owned

BGM/SFX artifacts are produced or selected in the assets stage. Compose and renderer only consume existing artifacts and references. Renderer must not generate missing sound, call providers, or infer sound choices from text.

### Decision 2: Local Library Is the First Source of Truth

`MediaLibraryItem` remains the shared source for approved BGM/SFX candidates. The first implementation should extend it only where necessary for selection and audit:

- keep existing fields: `library_item_id`, `type`, `file_uri`, `mime_type`, `duration_sec`, `loopable`, `tags`, `mood_tags`, `license`, `file_hash`, `imported_at`, `approved_for_use`;
- add optional matching metadata only if the implementation plan proves it is needed, such as `tempo_bpm`, `energy_level`, `intensity`, `instrument_tags`, `suitable_story_roles`, `source_label`;
- do not add UI-only fields or provider-specific response payloads to the shared library item.

The design favors a small extension because current tests already prove useful tag and license behavior.

### Decision 3: Cue Parameters Drive Deterministic Selection

`bgm_cue` and `sfx_cue` tasks should be interpreted structurally:

- `parameters.required_tags`: tags that must all match;
- `parameters.mood_tags`: mood tags used for ranking;
- `parameters.volume`: BGM placement volume override clamped to `0..1`; SFX may record this in metadata, but first renderer slice may keep the current default SFX volume unless the implementation plan explicitly adds SFX volume consumption;
- `parameters.fade_in_sec` / `parameters.fade_out_sec`: BGM-only, nonnegative;
- `parameters.scope`: BGM-only, `global | segment | segment_span`;
- `parameters.segment_ids`: BGM span target when scope is not global;
- `parameters.selection_label`: optional human-readable label for selection artifacts;
- `parameters.library_item_id`: optional explicit library item override, still requiring approval and license checks.

If cue parameters are missing, the provider uses conservative defaults:

- BGM required tags: `["background"]` unless a task gives stronger tags;
- BGM mood tags: task `parameters.mood_tags` or empty;
- SFX required tags: `parameters.sfx_tags`, then `parameters.required_tags`, otherwise no automatic selection;
- SFX mood tags: task `parameters.mood_tags` or empty.

No local string keyword classifier should infer tags from script text. The LLM planning stage may create structured tags, but local logic only consumes those tags.

### Decision 4: Concrete Audio Artifacts Are Preferred Over Selection-Only Artifacts

When an approved item is selected and has a resolvable local file or generated fake fixture, assets should create:

- `bgm_audio` for BGM;
- `sfx_audio` for SFX.

Selection-only artifacts remain useful when the system can identify a candidate but cannot materialize a file yet. They must not be treated as renderable by compose/renderer.

### Decision 5: Missing BGM/SFX Stay Optional

Initial BGM/SFX is non-blocking:

- missing BGM keeps `assets_bgm_missing_optional`, `compose_bgm_missing_optional`, or `render_bgm_missing_optional` warnings;
- missing SFX warns only when an explicit referenced artifact is missing;
- absence of optional BGM/SFX must not block `ready_for_compose` when required narration, subtitle and visual assets are ready.

Future required sound cues need a separate design because they affect readiness semantics.

### Decision 6: The First Provider Is Offline and Deterministic

The first implementation should add local/fake providers:

- `local_bgm` resolves approved BGM library items and writes or copies a WAV artifact into project storage;
- `local_sfx` resolves approved SFX library items and writes or copies a WAV artifact into project storage;
- tests can use deterministic short WAV generation instead of checked-in binary fixtures;
- provider output includes `library_item_id`, `selection_label`, `duration_sec`, `loopable`, license summary and match tags in artifact metadata.

If a `library://...` URI cannot be resolved to an actual file in the first slice, the fake provider may synthesize a quiet WAV but must preserve library metadata. The implementation plan must make this explicit in artifact metadata, for example `source_materialized_from: "generated_fixture"`.

## Data Contracts

### Media Library Item

Current `MediaLibraryItem` is close to sufficient. The first implementation should not replace it. If schema extension is needed, use optional fields:

```ts
{
  tempo_bpm?: number;
  energy_level?: "low" | "medium" | "high";
  intensity?: "subtle" | "moderate" | "strong";
  instrument_tags?: string[];
  suitable_story_roles?: string[];
  source_label?: string;
}
```

Do not require these fields for existing records. Existing tests and fixtures should stay valid.

### BGM Artifact Metadata

`bgm_audio.metadata` currently requires `duration_sec` and `loopable`. The first BGM/SFX implementation should add passthrough metadata such as:

```ts
{
  duration_sec: number;
  loopable: boolean;
  library_item_id?: string;
  selection_label?: string;
  license_type?: string;
  attribution_required?: boolean;
  attribution_text?: string;
  required_tags?: string[];
  matched_mood_tags?: string[];
  source_materialized_from?: "library_file" | "generated_fixture";
}
```

### SFX Artifact Metadata

`sfx_audio.metadata` currently requires `duration_sec`. The first implementation should add passthrough metadata such as:

```ts
{
  duration_sec: number;
  library_item_id?: string;
  selection_label?: string;
  license_type?: string;
  attribution_required?: boolean;
  attribution_text?: string;
  required_tags?: string[];
  matched_mood_tags?: string[];
  source_segment_id?: string | null;
  source_materialized_from?: "library_file" | "generated_fixture";
}
```

### BGM Placement

Existing `BgmPlacement` stays the placement contract:

- add optional `source_task_id` so assets execution can attach a returned BGM artifact to the placement created from the same `bgm_cue` task instead of filling the first empty placement;
- global BGM uses `scope="global"`, empty `segment_ids`, timeline start/end policies;
- segment BGM uses `scope="segment"` and one `segment_id`;
- span BGM uses `scope="segment_span"` and two or more `segment_ids`;
- `volume`, `fade_in_sec`, and `fade_out_sec` come from cue parameters or defaults.

The first implementation should not add ducking fields. Ducking requires a later audio mixing design.

## Execution Flow

### BGM

1. `buildInitialAssetManifest()` creates `BgmPlacement` from `bgm_cue` tasks.
2. The BGM provider reads the matching `bgm_cue` task.
3. It resolves explicit `library_item_id` or selects an approved BGM item by required tags and mood tags.
4. It writes a renderable local WAV artifact or copies a resolvable approved local file.
5. It returns `bgm_audio` with library metadata.
6. `assets-run.service` attaches the artifact to the `BgmPlacement` whose `source_task_id` matches the task; fallback matching by generated placement ID is allowed only for backward-compatible old manifests.
7. Compose emits `track_bgm` only when the placement references a `bgm_audio` artifact.
8. Remotion consumes the `bgm` audio clip with placement volume.

### SFX

1. `sfx_cue` tasks should generally be segment-scoped.
2. The SFX provider resolves explicit `library_item_id` or selects an approved SFX item by required tags and mood tags.
3. It writes a renderable local WAV artifact or copies a resolvable approved local file.
4. It returns `sfx_audio` with source segment and library metadata.
5. `assets-run.service` attaches the artifact to `audio_summary.sfx_artifact_ids` and the matching segment route.
6. Compose emits `track_sfx` clips at segment start with duration capped by the segment duration.
7. Remotion consumes the `sfx` audio clip at fixed default volume unless a later schema adds per-cue volume.

## Validation

The implementation plan should add tests that prove:

- media library schema still accepts existing records;
- unapproved or non-commercial items are never selected;
- explicit `library_item_id` still requires approval and commercial use;
- `bgm_cue` can produce `bgm_audio` and attach it to `BgmPlacement`;
- `sfx_cue` can produce `sfx_audio` and attach it to the matching segment route;
- missing optional BGM/SFX remains non-blocking;
- compose emits BGM/SFX tracks only for concrete audio artifacts;
- Remotion input props include BGM/SFX audio clips with data URI audio sources;
- runtime smoke can render fake/local BGM/SFX without real providers.

## Documentation Updates

After implementation, update:

- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `docs/plans/README.md`

The docs must state that real paid BGM/SFX providers, upload UI, publishing and licensing operations remain outside the first slice.

## Review Checklist

- Does the design avoid real paid provider calls by default?
- Does local logic consume structured tags instead of doing semantic keyword matching?
- Does compose/renderer remain consumer-only?
- Are selection-only artifacts clearly non-renderable?
- Are missing optional BGM/SFX still non-blocking?
- Are license and approval checks explicit before any item can be selected?
- Is the first slice testable with deterministic local WAV output?

## Residual Risks

- Generated fixture audio proves wiring, not production sound quality.
- Real music licensing and attribution packaging require a later operations design.
- Ducking and loudness normalization are not solved here.
- Asset planning may produce sparse or weak tags; improving prompt quality is separate from this local selection design.
- If future real providers return long or compressed audio, renderer data URI inlining may need to be replaced by a static asset serving path.
