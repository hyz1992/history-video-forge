import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";

describe("script api", () => {
  async function prepareConfirmedTopic(app: ReturnType<typeof buildApp>) {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Script API Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const recommendationResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });
    const candidateId = recommendationResponse.json().candidates[0].candidate_id as string;

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
    });

    return {
      projectId,
      topicPackage: confirmResponse.json().topic_package,
    };
  }

  it("POST /api/projects/:projectId/script/generate returns a sync mock result", async () => {
    const app = buildApp();
    const prepared = await prepareConfirmedTopic(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.project_id).toBe(prepared.projectId);
    expect(body.run_mode).toBe("sync_mock");
    expect(body.local_validation.stage).toBe("script_local_validation");
    expect(body.semantic_review.stage).toBe("script_semantic_review");
  });

  it("semantic review output stays within the allowed decision set and can expose patch_intent", async () => {
    const app = buildApp();
    const prepared = await prepareConfirmedTopic(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    const body = response.json();

    expect(["pass", "patch_once", "regen_once", "return_topic"]).toContain(
      body.semantic_review.decision,
    );
    expect([null, "fix", "lift"]).toContain(body.semantic_review.patch_intent);
  });

  it("patch_intent=lift does not mutate must_include_beats, scope, or narrative_tension_map", async () => {
    const app = buildApp();
    const prepared = await prepareConfirmedTopic(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    const body = response.json();

    expect(body.semantic_review.decision).toBe("patch_once");
    expect(body.semantic_review.patch_intent).toBe("lift");
    expect(body.semantic_review.soft_issues).toContain("hook_kill_power_weak");
    expect(body.input_bundle.hard_lane.must_include_beats).toEqual([
      "楚王连续压场，晏子一句句顶回去。",
    ]);
    expect(body.input_bundle.hard_lane.scope_label).toBe(
      prepared.topicPackage.scope_label,
    );
    expect(body.input_bundle.soft_lane.narrative_tension_map).toEqual(
      prepared.topicPackage.narrative_tension_map,
    );
  });
});
