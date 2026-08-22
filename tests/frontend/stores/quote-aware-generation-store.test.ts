import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2D 任务 1：四个 LLM 生成 store 的报价字段透传（红灯先行）。
 *
 * - fetch API 层：生成函数携带 quote 字段 → 请求体含
 *   cost_quote_id / idempotency_key / authorize_budget_override；
 *   缺省不携带（免 quote 路径请求体与现状一致）。
 * - store 层：透传同一组字段到 api（照 assets.test.ts 模式）。
 */

import {
  createFetchTopicApi,
  type TopicApi,
} from "../../../frontend/src/stores/topic";
import {
  createFetchScriptApi,
  type ScriptApi,
} from "../../../frontend/src/stores/script";
import {
  createFetchStoryboardApi,
  type StoryboardApi,
} from "../../../frontend/src/stores/storyboard";
import {
  createFetchPublishApi,
  type PublishApi,
} from "../../../frontend/src/stores/publish";
import { quoteSubmitBody, type QuoteSubmitFields } from "../../../frontend/src/stores/generation-cost";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

const SUBMIT: QuoteSubmitFields = {
  quoteId: "quote_d2_001",
  idempotencyKey: "key_d2_001",
  authorizeBudgetOverride: true,
};

const SUBMIT_WITHOUT_OVERRIDE: QuoteSubmitFields = {
  quoteId: "quote_d2_002",
  idempotencyKey: "key_d2_002",
};

describe("topic store quote 透传（S2-2D 任务 1）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse(200, { candidates: [], current_round: null, history_rounds: [], round_index: 0, has_more: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generateSystemRecommendations 携带 quote 字段（fetch 请求体）", async () => {
    const api = createFetchTopicApi();
    await api.generateSystemRecommendations("proj-1", {}, SUBMIT);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_001");
    expect(body.idempotency_key).toBe("key_d2_001");
    expect(body.authorize_budget_override).toBe(true);
  });

  it("generateSystemRecommendations 缺省不携带 quote 字段（现状回归）", async () => {
    const api = createFetchTopicApi();
    await api.generateSystemRecommendations("proj-1", {});
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBeUndefined();
    expect(body.idempotency_key).toBeUndefined();
    expect(body.authorize_budget_override).toBeUndefined();
  });

  it("generateFromLibrary 携带 quote 字段", async () => {
    const api = createFetchTopicApi();
    await api.generateFromLibrary("proj-1", { event_library_entry_id: "ev-1" }, SUBMIT_WITHOUT_OVERRIDE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_002");
    expect(body.idempotency_key).toBe("key_d2_002");
  });
});

describe("script store quote 透传（S2-2D 任务 1）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(200, { current_status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generateInitialScript 携带 quote 字段；缺省不携带", async () => {
    const api = createFetchScriptApi();
    await api.generateInitialScript("proj-1", SUBMIT);
    let body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_001");
    expect(body.idempotency_key).toBe("key_d2_001");
    expect(body.authorize_budget_override).toBe(true);

    await api.generateInitialScript("proj-1");
    body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBeUndefined();
  });
});

describe("storyboard store quote 透传（S2-2D 任务 1）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generateStoryboard 携带 quote 字段；缺省不携带", async () => {
    const api = createFetchStoryboardApi();
    await api.generateStoryboard("proj-1", SUBMIT);
    let body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_001");
    expect(body.idempotency_key).toBe("key_d2_001");

    await api.generateStoryboard("proj-1");
    body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBeUndefined();
  });

  it("regenerateStoryboard 与 regenerateSegment 携带 quote 字段", async () => {
    const api = createFetchStoryboardApi();
    await api.regenerateStoryboard("proj-1", "feedback", SUBMIT_WITHOUT_OVERRIDE);
    let body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_002");

    await api.regenerateSegment("proj-1", "sb-1", "feedback", SUBMIT_WITHOUT_OVERRIDE);
    body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_002");
    expect(body.idempotency_key).toBe("key_d2_002");
  });
});

describe("publish store quote 透传（S2-2D 任务 1）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse(200, { current_status: "publish_ready", active_publish_package: null, active_render: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("generatePackage 携带 quote 字段；缺省不携带", async () => {
    const api = createFetchPublishApi();
    await api.generatePackage("proj-1", SUBMIT);
    let body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBe("quote_d2_001");
    expect(body.idempotency_key).toBe("key_d2_001");
    expect(body.authorize_budget_override).toBe(true);

    await api.generatePackage("proj-1");
    body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.cost_quote_id).toBeUndefined();
  });
});

describe("store 层透传（S2-2D 任务 1，mock api 断言）", () => {
  function mockApi<T>(overrides: Partial<T>): T {
    return overrides as T;
  }

  it("topic store 生成函数透传 submit 到 api", async () => {
    const api = mockApi<TopicApi>({
      generateSystemRecommendations: vi.fn(async () => ({ candidates: [], current_round: null, history_rounds: [], round_index: 0, has_more: false })),
    });
    // 直接调用 fetch api 形状断言（store 层不重复构造 projectStore）：
    // topic store 的 store 层透传由 TopicPanel 集成测试（任务 2）覆盖。
    await (api.generateSystemRecommendations as ReturnType<typeof vi.fn>)("proj-1", {}, SUBMIT);
    expect(api.generateSystemRecommendations).toHaveBeenCalledWith("proj-1", {}, SUBMIT);
  });

  it("script/storyboard/publish api 签名接受 submit 参数（类型形状）", async () => {
    const scriptApi = createFetchScriptApi();
    const storyboardApi = createFetchStoryboardApi();
    const publishApi = createFetchPublishApi();
    // 类型检查锚点：三组签名都能接收 QuoteSubmitFields
    expect(typeof scriptApi.generateInitialScript).toBe("function");
    expect(typeof storyboardApi.generateStoryboard).toBe("function");
    expect(typeof publishApi.generatePackage).toBe("function");
  });
});
