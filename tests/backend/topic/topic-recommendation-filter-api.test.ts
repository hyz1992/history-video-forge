import { beforeEach, describe, expect, it, vi } from "vitest";

const builderCapture = vi.hoisted(() => {
  process.env.LLM_PROVIDER = "stub";
  return {
    inputs: [] as Array<Record<string, unknown>>,
  };
});

vi.mock(
  "../../../backend/src/modules/topic/topic-candidate.builder.js",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../backend/src/modules/topic/topic-candidate.builder.js")
    >();

    return {
      ...actual,
      buildTopicCandidates: vi.fn((input) => {
        builderCapture.inputs.push(input as unknown as Record<string, unknown>);
        return actual.buildTopicCandidates(input);
      }),
    };
  },
);

import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";

const seedPayload = {
  canonical_name: "medieval-history-recommendation",
  summary: "Recommend a focused historical event for narration.",
  core_conflict: "The event needs a clear conflict and consequence.",
  strong_scene: "Prefer an event with a concrete decisive scene.",
  source_hint: "Standard historical records",
  recent_usage_hint: "Avoid recently selected events",
  tags: ["medieval", "system_recommendation"],
};

const meaningfulFilters = {
  period_range: {
    start_id: "tang",
    end_id: "song_liao_xia_jin",
    included_period_ids: [
      "tang",
      "five_dynasties_ten_kingdoms",
      "song_liao_xia_jin",
    ],
  },
  event_domain: "political_power",
  central_actor_type: "ruler",
  storytelling_lens: "key_decision",
  exclude_terms: [" folklore ", "legend", "folklore"],
};

async function createProject(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { name: "S2-4 API Filter Test" },
    auth: buildTestAuth(),
  });

  expect(response.statusCode).toBe(201);
  return response.json().project_id as string;
}

describe("topic recommendation filter HTTP chain", () => {
  beforeEach(() => {
    builderCapture.inputs.length = 0;
  });

  it("passes a validated and normalized filter through controller and service to builder", async () => {
    const app = buildApp();
    const projectId = await createProject(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        ...seedPayload,
        filters: meaningfulFilters,
      },
      auth: buildTestAuth(),
    });

    expect(response.statusCode).toBe(200);
    expect(builderCapture.inputs.length).toBeGreaterThan(0);
    for (const input of builderCapture.inputs) {
      expect(input).toMatchObject({
        topic_filter: {
          period_range: meaningfulFilters.period_range,
          event_domain: "political_power",
          central_actor_type: "ruler",
          storytelling_lens: "key_decision",
          exclude_terms: ["folklore", "legend"],
        },
        topic_filter_fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      });
      expect(input).not.toHaveProperty("filters");
    }
  });

  it.each([
    ["invalid enum", { event_domain: "palace_intrigue" }],
    [
      "missing intermediate period",
      {
        period_range: {
          start_id: "tang",
          end_id: "song_liao_xia_jin",
          included_period_ids: ["tang", "song_liao_xia_jin"],
        },
      },
    ],
    [
      "reversed period range",
      {
        period_range: {
          start_id: "song_liao_xia_jin",
          end_id: "tang",
          included_period_ids: ["song_liao_xia_jin", "tang"],
        },
      },
    ],
    ["unknown filter field", { event_domain: "political_power", conflict_core: "status" }],
    ["overlong exclude term", { exclude_terms: ["x".repeat(41)] }],
  ])("rejects %s before invoking the builder", async (_name, filters) => {
    const app = buildApp();
    const projectId = await createProject(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        ...seedPayload,
        filters,
      },
      auth: buildTestAuth(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_topic_filter",
      invalid_fields: ["filters"],
    });
    expect(builderCapture.inputs).toHaveLength(0);
  });

  it("prioritizes an invalid recommendation seed over an invalid filter", async () => {
    const app = buildApp();
    const projectId = await createProject(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        ...seedPayload,
        canonical_name: "",
        filters: { event_domain: "invalid-domain" },
      },
      auth: buildTestAuth(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_topic_recommendation_seed",
      invalid_fields: expect.arrayContaining(["canonical_name"]),
    });
    expect(builderCapture.inputs).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["empty", {}],
    ["auto only", { storytelling_lens: "auto" }],
    ["blank exclusions", { exclude_terms: [" ", "  "] }],
  ])("keeps %s filters out of builder input", async (_name, filters) => {
    const app = buildApp();
    const projectId = await createProject(app);
    const payload = filters === undefined
      ? seedPayload
      : { ...seedPayload, filters };

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload,
      auth: buildTestAuth(),
    });

    expect(response.statusCode).toBe(200);
    expect(builderCapture.inputs.length).toBeGreaterThan(0);
    for (const input of builderCapture.inputs) {
      expect(input).not.toHaveProperty("filters");
      expect(input).not.toHaveProperty("topic_filter");
      expect(input).not.toHaveProperty("topic_filter_fingerprint");
    }
  });
});
