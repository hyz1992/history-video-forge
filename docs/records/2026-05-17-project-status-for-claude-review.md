# 2026-05-17 Project Status for Claude Code Review

> 2026-05-19 superseded note: this handoff is a historical review snapshot. Current formal status has moved on: compose v1 and renderer/export v1 backend paths are implemented, and DashScope image-to-video exists as an explicit opt-in assets provider path with mocked/API coverage and an explicit live-check harness. Use `AGENTS.md`, `docs/README.md`, `docs/architecture/`, and `docs/plans/README.md` as the current truth source.

## Purpose

This note is written as a review handoff for Claude Code or another coding agent.

It states the current project phase, what is actually working, what is only partially working, and what has not been started. It is intentionally conservative: do not treat the full video pipeline as complete.

## Current Phase

The project is currently at:

> compose v1 complete, renderer / export design and implementation plan ready, implementation not started.

The backend pipeline has reached a persisted timeline contract. The next engineering phase should be renderer / export, starting with local still-image motion rendering into MP4.

## Safe Current Claim

Safe claim:

> The project can progress from upstream planning through active assets into a persisted `ComposeTimeline`, expose active compose state in the project snapshot, and clear stale compose state when upstream data changes.

Unsafe claim:

> The project can produce a final video.

That is not true yet. There is no implemented renderer/export stage, no MP4 output, no Remotion path, and no DashScope image-to-video path.

## Stage Status

| Stage | Status | Current Meaning |
| --- | --- | --- |
| `topic` | usable / frozen for now | Topic package and candidate flow are treated as upstream foundation. |
| `script` | usable / frozen for now | First-draft script path is stable enough for downstream work. |
| `storyboard` | v1 backend complete | Converts active script into storyboard plan; does not rewrite script. |
| `asset planning` | v1 backend complete | Converts storyboard into asset tasks; does not generate files by itself. |
| `assets` | v1 execution foundation complete | Builds asset manifest; has fake/local path and explicit DashScope TTS/text-to-image provider checks. |
| `compose` | v1 backend timeline complete | Converts active asset manifest into persisted `ComposeTimeline`; no rendering. |
| `renderer / export` | design only | New design and implementation plan added; no code implemented yet. |
| frontend downstream UI | not started | No assets/compose/render review UI. |
| publishing workflow | not started | No platform export or publish API. |

## Links to New Review Documents

- Renderer design: `docs/architecture/renderer-stage-design.md`
- Renderer implementation plan: `docs/plans/2026-05-17-renderer-stage-implementation-plan.md`
- Compose completion checklist: `docs/records/2026-05-17-compose-stage-completion-checklist.md`
- Assets completion checklist: `docs/records/2026-05-16-assets-stage-completion-checklist.md`

## Chains That Are Fully Walked Within Current Scope

The following chains are walked by focused tests or runtime smoke within their declared v1 scope:

- `topic -> script` first-draft foundation
- active `script -> storyboard`
- active `storyboard -> asset planning`
- active `asset planning -> assets manifest`
- active `assets manifest -> compose timeline`
- upstream invalidation into compose:
  - new script clears storyboard, asset plan, assets, compose;
  - new storyboard clears asset plan, assets, compose;
  - new asset plan clears assets, compose;
  - new asset manifest clears compose.

The compose smoke specifically covers:

- fake/local assets generation;
- compose generation;
- snapshot exposes `active_compose`;
- refreshed assets clear stale `active_compose`.

## Real Provider Status

DashScope configuration is now explicit:

- `ALIYUN_DASHSCOPE_API_KEY`
- `ALIYUN_DASHSCOPE_BASE_URL`
- `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL`
- `ALIYUN_DASHSCOPE_TTS_MODEL`
- future-facing `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`

The current real provider confidence is limited to explicit assets checks:

- DashScope TTS provider path;
- DashScope text-to-image provider path.

DashScope image-to-video is not implemented.

## What Is Not Done

The following are still not done:

- compose timeline to rendered video;
- local Remotion renderer;
- MP4 export;
- output probing and render record persistence;
- DashScope image-to-video provider;
- BGM/SFX real lifecycle beyond optional manifest/timeline references;
- frontend assets preview/review UI;
- frontend compose preview UI;
- frontend render preview UI;
- upload/replace/accept UI for user-managed media;
- publication-level fact checking and manual edit workflow.

## Known Verification Evidence

Most recent focused verification recorded during compose closeout:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/compose tests/backend/api/compose-api.test.ts
```

Observed:

- test files: `4 passed`
- tests: `38 passed`

Affected downstream regression:

```bash
npx vitest run --configLoader runner tests/backend/assets tests/backend/api/assets-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

Observed:

- test files: `18 passed`
- tests: `109 passed`

Diff/status checks:

```bash
git diff --check
git status --short storage/topic-candidate-library harness/scripts/runtime/output
```

Observed:

- `git diff --check` returned success; Windows LF-to-CRLF warnings may print.
- generated runtime output and `storage/topic-candidate-library` did not appear in git status.

## Known Caveat

Global typecheck is not currently the completion gate.

Earlier `npx tsc --noEmit` was not clean because the repository has pre-existing unrelated type errors. A reviewer should not infer global type safety from the focused green tests above.

## Review Focus Suggested for Claude Code

Claude Code should review:

1. Whether compose v1 correctly stops at timeline contract and avoids hidden rendering responsibilities.
2. Whether `renderer-stage-design.md` chooses the right first slice: local render/export before DashScope image-to-video.
3. Whether `2026-05-17-renderer-stage-implementation-plan.md` is sufficiently small, testable, and consistent with existing repository patterns.
4. Whether upstream invalidation rules for future render records are complete.
5. Whether any docs overclaim "full video pipeline complete".

## Next Recommendation

Next recommended action after review:

1. Have Claude Code review these docs and the dirty diff for boundary mistakes.
2. If the review passes, execute Task 1 of the renderer implementation plan only.
3. Keep DashScope image-to-video as a later assets provider design, not part of renderer v1.
