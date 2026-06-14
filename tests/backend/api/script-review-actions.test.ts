import { describe, expect, it, vi } from "vitest";

const weakDraft = {
  script_text:
    "楚王第一轮压场时，晏子已经看出这不是一句话的冲突。所有人都看到使者被领到偏门而非正门。入楚受辱只是开始，真正的狠处在于后面还会层层加码。楚王安排人带晏子走偏门，这是第一层试探。晏子站在偏门前不动，直接说了一句：使狗国者从狗门入。楚王在公开场合连续压场，晏子当场顶回去。这一句话把局面直接顶了回去。楚王不甘心，又安排了第二层压场。在朝堂上当着所有人面，安排押送过来的齐国犯人。楚王连续压场，晏子一句句顶回去。晏子不慌不忙，用同样逻辑反问楚王。楚王当众压场，晏子必须当场顶回。到橘枳之喻落下来时，场面才真正翻了过去。橘生淮南则为橘，生于淮北则为枳。这一句话把楚王彻底堵住，当场再无人敢压。当事人不能随便低头，因为一退就会让后面的压力继续压上来。这种场面一退掉的就不只是自己，而是整个使节背后的国面。",
  estimated_duration_sec: 84,
  beat_trace: [
    {
      beat: "楚王在公开场合连续压场，晏子当场顶回去。",
      excerpt: "楚王在公开场合连续压场，晏子当场顶回去。这一句话把局面直接顶了回去",
      confidence: 0.94,
    },
    {
      beat: "楚王连续压场，晏子一句句顶回去。",
      excerpt: "楚王连续压场，晏子一句句顶回去。晏子不慌不忙，用同样逻辑反问楚王",
      confidence: 0.93,
    },
    {
      beat: "楚王当众压场，晏子必须当场顶回。",
      excerpt: "楚王当众压场，晏子必须当场顶回。到橘枳之喻落下来时",
      confidence: 0.92,
    },
  ],
  quote_trace: [],
  opening_span: "所有人都看到使者被领到偏门而非正门。",
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
    "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？晏子敢。楚王在公开场合连续压场，晏子当场顶回去。这种场面一退掉的就不只是自己，而是整个使节背后的国面。楚王连续压场，晏子一句句顶回去，真正可怕的是他把齐国颜面也一起顶住了。楚王当众压场，晏子必须当场顶回。所有人都在看着这场对峙，谁先退谁就输了整个场面。楚王三次压场，晏子三次顶回。每一次顶回都让齐国的面子更稳固了一分。到最后橘枳之喻一落，楚王再也找不到可以压的角度。当事人不能随便低头，因为低头意味着承认对方的框架。这种场面一旦退掉，后面的压力只会越来越大。全场安静下来的时候，所有人都明白了一件事：这个矮个子使者，凭一张嘴把楚王的连环压场全部顶了回去。晏子离开楚国朝堂时，身后没有一个人再敢嘲笑齐国的使者。",
  estimated_duration_sec: 86,
  beat_trace: [
    {
      beat: "楚王在公开场合连续压场，晏子当场顶回去。",
      excerpt: "楚王在公开场合连续压场，晏子当场顶回去。这种场面一退掉的就不只是自己",
      confidence: 0.96,
    },
    {
      beat: "楚王连续压场，晏子一句句顶回去。",
      excerpt: "楚王连续压场，晏子一句句顶回去，真正可怕的是他把齐国颜面也一起顶住了",
      confidence: 0.94,
    },
    {
      beat: "楚王当众压场，晏子必须当场顶回。",
      excerpt: "楚王当众压场，晏子必须当场顶回。所有人都在看着这场对峙",
      confidence: 0.92,
    },
  ],
  quote_trace: [],
  opening_span: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
  ending_span: "这种场面一旦退掉，后面的压力只会越来越大。",
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
    expect(body.semantic_review.decision).toBe("skipped");
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
    expect(body.semantic_review.decision).toBe("skipped");
  });
  it("archives the previous current script when a new topic is confirmed for the same project", async () => {
    generateScriptDraft.mockReset();
    generateScriptDraft.mockResolvedValueOnce(regeneratedDraft);

    const app = buildApp();
    const projectId = await prepareConfirmedTopic(app);

    const firstScriptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
      },
    });

    expect(firstScriptResponse.statusCode).toBe(200);

    const secondRecommendationResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "寮犲贰瀹堝煄",
        summary: "寮犲贰瀹堝煄鍚庝粛瑕佸湪瀛ょ珛鏃犳彺鏃堕《浣忓叏鍩庡帇鍔涖€?",
        core_conflict: "瀛ょ珛鏃犳彺锛屼絾涓嶈兘閫€銆?",
        strong_scene: "鍩庡ご涓嬩汉蹇冨姩鎽囷紝寮犲贰褰撳満鎶婂満闈㈢珛浣忋€?",
        source_hint: "銆婃柊鍞愪功銆?",
        recent_usage_hint: "鍚屼竴椤圭洰閲嶉€夋柊涓婚",
        tags: ["battle", "showdown", "defense"],
      },
    });
    const nextCandidateId = secondRecommendationResponse.json().candidates[0].candidate_id as string;

    const confirmResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/candidates/${nextCandidateId}/confirm`,
      payload: {
        confirm_reason: "replace_current_topic",
      },
    });

    expect(confirmResponse.statusCode).toBe(200);

    const snapshotResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
    });

    expect(snapshotResponse.statusCode).toBe(200);

    const snapshot = snapshotResponse.json();
    expect(snapshot.active_topic_package.canonical_title).toBe("寮犲贰瀹堝煄");
    expect(snapshot.active_script).toBeNull();
    expect(app.db.scriptRecords.size).toBe(1);
  });
});
