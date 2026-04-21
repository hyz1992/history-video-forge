import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";

describe("project snapshot api", () => {
  async function prepareProjectWithScript(app: ReturnType<typeof buildApp>) {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Snapshot API Flow",
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

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
    });

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    return projectId;
  }

  it("GET /api/projects/:projectId returns topic/script snapshot for restoring the current state", async () => {
    const app = buildApp();
    const projectId = await prepareProjectWithScript(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toMatchObject({
      project_id: projectId,
      current_status: "script_ready",
      active_topic_package: {
        topic_package_id: expect.any(String),
        canonical_title: "晏子使楚",
      },
      active_script: {
        script_record_id: expect.any(String),
        script_text: expect.any(String),
        review_decision: expect.any(String),
        patch_intent: expect.anything(),
        execution_state: {
          patch_used: expect.any(Boolean),
          regenerate_used: expect.any(Boolean),
        },
      },
    });
    expect(body.active_script.local_validation.stage).toBe(
      "script_local_validation",
    );
    expect(body.active_script.semantic_review.stage).toBe(
      "script_semantic_review",
    );
  });

  it("returns restore metadata for draft and formal projects", async () => {
    const app = buildApp();

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Restore Metadata Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const draftSnapshot = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
    });

    expect(draftSnapshot.statusCode).toBe(200);
    expect(draftSnapshot.json()).toMatchObject({
      project_id: projectId,
      current_status: "topic_pending",
      is_draft: true,
      restore_route: `/projects/${projectId}/topic`,
      active_topic_package: null,
      active_script: null,
    });

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

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
    });

    const formalSnapshot = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
    });

    expect(formalSnapshot.statusCode).toBe(200);
    expect(formalSnapshot.json()).toMatchObject({
      project_id: projectId,
      current_status: "script_ready",
      is_draft: false,
      restore_route: `/projects/${projectId}/script`,
      active_topic_package: {
        topic_package_id: expect.any(String),
      },
      active_script: null,
    });
  });
});
