import { describe, expect, it, vi } from "vitest";

import type { LlmInteractionLogEntry } from "../../../backend/src/runtime/llm/interaction-log.js";
import { createChunkInteractionAccounting } from "../../../backend/src/modules/asset-planning/chunk-interaction-accounting.js";

function entry(attempts: LlmInteractionLogEntry["attempts"]): LlmInteractionLogEntry {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z",
    provider: "test",
    model: "test",
    operationName: "secret operation",
    promptId: "secret prompt",
    promptStage: "asset_planning",
    promptLanguage: "zh-CN",
    promptFilePath: "secret",
    systemPrompt: "RAW_SECRET_PROMPT",
    input: { secret: "RAW_SECRET_INPUT" },
    rawOutput: "RAW_SECRET_OUTPUT",
    attempts,
    promptSha256: "hash",
    promptVersion: "1",
  };
}

describe("chunk interaction accounting", () => {
  it("aggregates real attempts across business and safety invocations without retaining payloads", () => {
    const accounting = createChunkInteractionAccounting("chunk_001");
    accounting.beginInvocation({ businessSlot: 1, safety: false }).write(entry([
      { attempt: 1, startedAt: "a", finishedAt: "b", durationMs: 1, outcome: "error" },
      { attempt: 2, startedAt: "b", finishedAt: "c", durationMs: 1, outcome: "success" },
    ]));
    accounting.beginInvocation({ businessSlot: 1, safety: true }).write(entry([
      { attempt: 1, startedAt: "c", finishedAt: "d", durationMs: 1, outcome: "success" },
    ]));
    accounting.beginInvocation({ businessSlot: 2, safety: false }).write(entry([
      { attempt: 1, startedAt: "d", finishedAt: "e", durationMs: 1, outcome: "success" },
    ]));

    const snapshot = accounting.snapshot();
    expect(snapshot).toEqual({
      chunk_id: "chunk_001",
      business_slot: 2,
      logical_invocation: 3,
      safety_invocation: 1,
      provider_attempts: 4,
      network_request_count: 4,
    });
    expect(JSON.stringify(snapshot)).not.toContain("RAW_SECRET");
  });

  it("isolates chunks and ignores duplicate writes plus malformed attempts deterministically", () => {
    const first = createChunkInteractionAccounting("chunk_001");
    const second = createChunkInteractionAccounting("chunk_002");
    const writer = first.beginInvocation({ businessSlot: 1, safety: false });
    const valid = entry([{ attempt: 1, startedAt: "a", finishedAt: "b", durationMs: 1, outcome: "success" }]);
    writer.write(valid);
    writer.write(valid);
    second.beginInvocation({ businessSlot: 1, safety: false }).write({ ...entry(undefined), attempts: [{ attempt: 0 } as never] });

    expect(first.snapshot()).toMatchObject({ logical_invocation: 1, provider_attempts: 1 });
    expect(second.snapshot()).toMatchObject({ logical_invocation: 1, provider_attempts: 0, network_request_count: 0 });
  });

  it("forwards each entry to the supplied writer", async () => {
    const write = vi.fn();
    const accounting = createChunkInteractionAccounting("chunk_001", { write });
    const value = entry([]);
    await accounting.beginInvocation({ businessSlot: 1, safety: false }).write(value);
    expect(write).toHaveBeenCalledWith(value);
  });

  it("ignores a runtime non-object entry without throwing or leaking it", () => {
    const accounting = createChunkInteractionAccounting("chunk_001");
    expect(() => accounting.beginInvocation({ businessSlot: 1, safety: false }).write(null as never)).not.toThrow();
    expect(accounting.snapshot()).toMatchObject({
      business_slot: 1,
      logical_invocation: 1,
      provider_attempts: 0,
      network_request_count: 0,
    });
  });

  it("counts an invocation before a gateway can ignore its writer or throw", () => {
    const accounting = createChunkInteractionAccounting("chunk_001");
    accounting.beginInvocation({ businessSlot: 3, safety: true });
    expect(accounting.snapshot()).toEqual({
      chunk_id: "chunk_001", business_slot: 3, logical_invocation: 1,
      safety_invocation: 1, provider_attempts: 0, network_request_count: 0,
    });
  });

  it("counts attempts from only the first valid entry but forwards duplicate writes", async () => {
    const downstream = { write: vi.fn() };
    const accounting = createChunkInteractionAccounting("chunk_001", downstream);
    const writer = accounting.beginInvocation({ businessSlot: 1, safety: false });
    await writer.write(entry([{ attempt: 1, startedAt: "a", finishedAt: "b", durationMs: 1, outcome: "success" }]));
    await writer.write(entry([
      { attempt: 1, startedAt: "a", finishedAt: "b", durationMs: 1, outcome: "error" },
      { attempt: 2, startedAt: "b", finishedAt: "c", durationMs: 1, outcome: "success" },
    ]));
    expect(accounting.snapshot()).toMatchObject({ logical_invocation: 1, provider_attempts: 1 });
    expect(downstream.write).toHaveBeenCalledTimes(2);
  });

  it("keeps its snapshot stable while preserving downstream sync and async failures", async () => {
    const oneAttempt = entry([
      { attempt: 1, startedAt: "a", finishedAt: "b", durationMs: 1, outcome: "success" },
    ]);
    const sync = createChunkInteractionAccounting("sync", {
      write() { throw new Error("sync writer failure"); },
    });
    expect(() => sync.beginInvocation({ businessSlot: 1, safety: false }).write(oneAttempt))
      .toThrow("sync writer failure");
    expect(sync.snapshot()).toMatchObject({ logical_invocation: 1, provider_attempts: 1 });

    const asyncAccounting = createChunkInteractionAccounting("async", {
      write() { return Promise.reject(new Error("async writer failure")); },
    });
    await expect(asyncAccounting.beginInvocation({ businessSlot: 2, safety: true }).write(oneAttempt))
      .rejects.toThrow("async writer failure");
    expect(asyncAccounting.snapshot()).toMatchObject({
      business_slot: 2, logical_invocation: 1, safety_invocation: 1, provider_attempts: 1,
    });
  });
});
