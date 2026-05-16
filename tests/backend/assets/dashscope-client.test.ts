/**
 * DashScope client shell tests (mocked fetch).
 *
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { describe, expect, it, vi } from "vitest";
import {
  submitDashscopeAsyncTask,
  pollDashscopeTask,
  downloadDashscopeOutput,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-client.js";

describe("dashscope client", () => {
  it("async submit includes X-DashScope-Async: enable header", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return new Response(
          JSON.stringify({ output: { task_id: "task_001" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    await submitDashscopeAsyncTask({
      apiKey: "test-key",
      endpoint: "https://dashscope.test/api/v1/services/aigc/image-generation/generation",
      payload: { model: "wan-test" },
    });

    expect(fetchCalls[0].init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-DashScope-Async": "enable",
    });
  });

  it("poll reads task status", async () => {
    vi.stubGlobal(
      "fetch",
      async () => {
        return new Response(
          JSON.stringify({
            output: { task_id: "task_001", task_status: "SUCCEEDED", results: [{ url: "https://example.com/img.png" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const result = await pollDashscopeTask({
      apiKey: "test-key",
      taskId: "task_001",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.outputUrl).toBe("https://example.com/img.png");
  });

  it("download returns a Buffer", async () => {
    vi.stubGlobal(
      "fetch",
      async () => {
        return new Response(new Uint8Array([0x48, 0x49]).buffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      },
    );

    const buffer = await downloadDashscopeOutput("https://example.com/img.png");

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(2);
  });

  it("failed provider status normalizes to an error result", async () => {
    vi.stubGlobal(
      "fetch",
      async () => {
        return new Response(
          JSON.stringify({
            output: { task_id: "task_fail", task_status: "FAILED", code: "InvalidParameter", message: "Bad input" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const result = await pollDashscopeTask({
      apiKey: "test-key",
      taskId: "task_fail",
    });

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("InvalidParameter");
    expect(result.errorMessage).toBe("Bad input");
  });

  it("extracts audio URL from TTS response", async () => {
    vi.stubGlobal(
      "fetch",
      async () => {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              audio: { url: "https://example.com/audio.wav" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const result = await pollDashscopeTask({
      apiKey: "test-key",
      taskId: "task_002",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.outputUrl).toBe("https://example.com/audio.wav");
  });

  it("throws when task_id is missing from submit response", async () => {
    vi.stubGlobal(
      "fetch",
      async () => {
        return new Response(
          JSON.stringify({ output: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    await expect(
      submitDashscopeAsyncTask({
        apiKey: "test-key",
        endpoint: "https://dashscope.test/api/test",
        payload: {},
      }),
    ).rejects.toThrow("Missing task_id");
  });
});
