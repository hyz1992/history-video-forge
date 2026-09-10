import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createLegacyProject } from "../projects/legacy-project.fixture.js";
import { seedGenerationCatalog } from "../helpers/seed-generation-catalog.js";
import { buildTestAuth } from "../auth/test-utils.js";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("project snapshot api", () => {
  async function prepareProjectWithScript(app: ReturnType<typeof buildApp>, auth: AuthenticatedAuthContext) {
    const projectResponse = await createLegacyProject(app.db, { name: 'Snapshot API Flow', ownerId: "test-user", createdById: "test-user" });
const projectId = projectResponse.id;

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

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
      auth,
    });

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
      auth,
    });

    return projectId;
  }

  it("GET /api/projects/:projectId returns topic/script snapshot for restoring the current state", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = buildTestAuth();
    const projectId = await prepareProjectWithScript(app, auth);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      auth,
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
        patch_intent: null,
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
    seedGenerationCatalog(app);
    const auth = buildTestAuth();

    const projectResponse = await createLegacyProject(app.db, { name: 'Restore Metadata Flow', ownerId: "test-user", createdById: "test-user" });
const projectId = projectResponse.id;

    const draftSnapshot = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      auth,
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
      auth,
    });
    const candidateId = recommendationResponse.json().candidates[0].candidate_id as string;

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
      auth,
    });

    const formalSnapshot = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      auth,
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

  it("persists readable trace directories and keeps latest topic/script run summaries after re-confirming a topic", async () => {
    const app = buildApp();
    seedGenerationCatalog(app);
    const auth = buildTestAuth();

    const projectResponse = await createLegacyProject(app.db, { name: 'Snapshot Trace Flow', ownerId: "test-user", createdById: "test-user" });
const projectId = projectResponse.id;

    const firstRecommendation = await app.inject({
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
    const firstCandidateId = firstRecommendation.json().candidates[0].candidate_id as string;

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${firstCandidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
      auth,
    });

    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
      },
      auth,
    });

    const firstSnapshotResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      auth,
    });
    const firstSnapshot = firstSnapshotResponse.json();
    const storageRootPath = resolve(
      rootDir,
      firstSnapshot.trace_summary.project_storage.root_dir as string,
    );

    try {
      expect(firstSnapshot.trace_summary.latest_topic_run).toMatchObject({
        phase: "topic",
        run_id: expect.any(String),
      });
      expect(firstSnapshot.trace_summary.latest_script_run).toMatchObject({
        phase: "script",
        run_id: expect.any(String),
      });
      expect(existsSync(storageRootPath)).toBe(true);
      expect(existsSync(resolve(storageRootPath, "trace", "topic-runs"))).toBe(true);
      expect(existsSync(resolve(storageRootPath, "trace", "script-runs"))).toBe(true);
      expect(readdirSync(resolve(storageRootPath, "trace", "topic-runs")).length).toBeGreaterThan(0);
      expect(readdirSync(resolve(storageRootPath, "trace", "script-runs")).length).toBeGreaterThan(0);

      const secondRecommendation = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/topic/recommendations`,
        payload: {
          canonical_name: "晏子使楚",
          summary: "楚王第二次换角度压场，晏子仍然当场顶回去。",
          core_conflict: "公开压场继续升级，晏子不能退。",
          strong_scene: "楚王再次压场，晏子换方式顶回。",
          source_hint: "《晏子春秋》",
          recent_usage_hint: "近期未出现同 event_id",
          tags: ["diplomacy", "court", "humiliation", "showdown"],
        },
        auth,
      });
      const secondCandidateId = secondRecommendation.json().candidates[0].candidate_id as string;

      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/topic/candidates/${secondCandidateId}/confirm`,
        payload: {
          confirm_reason: "user_selected_again",
        },
        auth,
      });

      const secondSnapshotResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}`,
        auth,
      });

      expect(secondSnapshotResponse.statusCode).toBe(200);
      expect(secondSnapshotResponse.json()).toMatchObject({
        project_id: projectId,
        current_status: "script_ready",
        active_script: null,
        trace_summary: {
          latest_topic_run: {
            phase: "topic",
            run_id: expect.any(String),
          },
          latest_script_run: {
            phase: "script",
            run_id: expect.any(String),
          },
        },
      });
    } finally {
      rmSync(storageRootPath, {
        recursive: true,
        force: true,
      });
    }
  });
});
