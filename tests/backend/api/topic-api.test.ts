import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { seedGenerationCatalog } from "../helpers/seed-generation-catalog.js";
import { buildTestAuth } from "../auth/test-utils.js";

describe("topic api", () => {
  it("creates a project", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Topic API Contract",
      },
      auth: buildTestAuth(),
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.project_id).toBeTypeOf("string");
    expect(body.current_status).toBe("topic_pending");
  });

  it("returns topic recommendations for a project", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = buildTestAuth();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Recommendation Flow",
      },
      auth,
    });
    const projectId = projectResponse.json().project_id as string;

    const response = await app.inject({
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
      auth,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.project_id).toBe(projectId);
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates[0]).toMatchObject({
      candidate_id: expect.any(String),
      title: "晏子使楚",
      family_label: expect.any(String),
    });
  });

  it("confirms a candidate into TopicPackage and moves project to script_ready", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = buildTestAuth();
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Confirm Flow",
      },
      auth,
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
      auth,
    });
    const candidateId = recommendationResponse.json().candidates[0].candidate_id as string;

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
      auth,
    });

    expect(confirmResponse.statusCode).toBe(200);

    const body = confirmResponse.json();
    expect(body.project_id).toBe(projectId);
    expect(body.current_status).toBe("script_ready");
    expect(body.topic_package).toMatchObject({
      topic_package_id: expect.any(String),
      canonical_title: "晏子使楚",
      strong_scene: "楚王在公开场合连续压场，晏子当场顶回去。",
      duration_band: expect.anything(),
      narrative_tension_map: {
        hook_claim: expect.any(String),
        pressure_escalation: expect.any(String),
        mid_reveal: expect.any(String),
        peak_payoff: expect.any(String),
        ending_residue: expect.any(String),
      },
    });
  });
});
