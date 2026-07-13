import { describe, expect, it, vi } from "vitest";

const runtimeDraft = {
  script_text:
    "这是 runtime writer 返回的脚本草稿，不应再走 deterministic mock draft。",
  estimated_duration_sec: 86,
  beat_trace: [
    {
      beat: "入楚受辱",
      excerpt: "这是 runtime writer 返回的脚本草稿",
      confidence: 0.95,
    },
  ],
  quote_trace: [],
  opening_span: "这是 runtime writer 返回的脚本草稿。",
  ending_span: "不应再走 deterministic mock draft。",
};

vi.mock("../../../backend/src/modules/script/script-generation.service.js", () => ({
  generateScriptDraft: vi.fn(async () => runtimeDraft),
}));

import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";

describe("script generate api runtime", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  async function prepareConfirmedTopic(app: ReturnType<typeof buildApp>) {
    const projectResponse = await app.inject({ auth,
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Script Runtime API Flow",
      },
    });
    const projectId = projectResponse.json().project_id as string;

    const recommendationResponse = await app.inject({ auth,
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

    await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
      payload: {
        confirm_reason: "user_selected",
      },
    });

    return projectId;
  }

  it("uses the formal writer path and preserves draft/local_validation/semantic_review fields", async () => {
    const app = buildApp();
    const projectId = await prepareConfirmedTopic(app);

    const response = await app.inject({ auth,
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.project_id).toBe(projectId);
    expect(body.run_mode).not.toBe("sync_mock");
    expect(body.draft).toMatchObject({
      script_text: "这是 runtime writer 返回的脚本草稿，不应再走 deterministic mock draft。",
      opening_span: expect.any(String),
      ending_span: expect.any(String),
    });
    expect(body.local_validation.stage).toBe("script_local_validation");
    expect(body.semantic_review.stage).toBe("script_semantic_review");
  });
});
