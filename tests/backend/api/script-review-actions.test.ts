import { describe, expect, it, vi } from "vitest";

const weakDraft = {
  script_text:
    "楚王第一轮压场时，晏子已经看出这不是一句话的冲突。入楚受辱只是开始，真正的狠处在于后面还会层层加码。到橘枳之喻落下来时，场面才真正翻了过去。",
  estimated_duration_sec: 84,
  beat_trace: [
    {
      beat: "楚王连续压场，晏子一句句顶回去。",
      excerpt: "楚王连续压场，晏子一句句顶回去。",
      confidence: 0.94,
    },
  ],
  quote_trace: [],
  opening_span: "楚王第一轮压场时，晏子已经看出这不是一句话的冲突。",
  ending_span: "场面翻了过去。",
};

const invalidDraft = {
  script_text: "太短",
  estimated_duration_sec: 84,
  beat_trace: [],
  quote_trace: [],
  opening_span: "",
  ending_span: "",
};

const regeneratedDraft = {
  script_text:
    "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？晏子敢。楚王连续压场，晏子一句句顶回去，真正可怕的是他把齐国颜面也一起顶住了。这种场面，一退掉的就不只是自己，而是整个使节背后的国面。",
  estimated_duration_sec: 86,
  beat_trace: [
    {
      beat: "楚王连续压场，晏子一句句顶回去。",
      excerpt: "楚王连续压场，晏子一句句顶回去。",
      confidence: 0.96,
    },
  ],
  quote_trace: [],
  opening_span: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
  ending_span: "这种场面，一退掉的就不只是自己，而是整个使节背后的国面。",
};

const { generateScriptDraft } = vi.hoisted(() => ({
  generateScriptDraft: vi.fn(),
}));

vi.mock("../../../backend/src/modules/script/script-generation.service.js", () => ({
  generateScriptDraft,
}));

import { buildApp } from "../../../backend/src/app.js";

describe("script review actions api", () => {
  async function prepareConfirmedTopic(app: ReturnType<typeof buildApp>) {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Script Review Actions Flow",
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

    return projectId;
  }

  it("maps patch_once into a single internal patch and re-runs validation/review", async () => {
    generateScriptDraft.mockReset();
    generateScriptDraft.mockResolvedValueOnce(weakDraft);

    const app = buildApp();
    const projectId = await prepareConfirmedTopic(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(generateScriptDraft).toHaveBeenCalledTimes(1);
    expect(body.draft.opening_span).toContain("所有人");
    expect(body.local_validation.decision).toBe("pass");
    expect(body.semantic_review.decision).toBe("pass");
  });

  it("maps regen_once into a single internal regenerate and re-runs validation/review", async () => {
    generateScriptDraft.mockReset();
    generateScriptDraft
      .mockResolvedValueOnce(invalidDraft)
      .mockResolvedValueOnce(regeneratedDraft);

    const app = buildApp();
    const projectId = await prepareConfirmedTopic(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: true,
        allow_regen: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(generateScriptDraft).toHaveBeenCalledTimes(2);
    expect(body.draft.script_text).toContain("所有人");
    expect(body.local_validation.decision).toBe("pass");
    expect(body.semantic_review.decision).toBe("pass");
  });
});
