import { describe, expect, it, vi } from "vitest";

import type { StructuredPromptProvider } from "../../../backend/src/runtime/llm/provider-contract.js";
import type { LoadedPrompt } from "../../../backend/src/runtime/prompts/prompt-loader.js";

interface StubInvokeRecorder {
  structuredPromptCalls: string[];
  strictStructuredCalls: string[];
}

function createRecordingStubProvider(
  label: string,
  recorder: StubInvokeRecorder,
): StructuredPromptProvider {
  return {
    capabilities: {
      jsonObject: true,
      toolCall: true,
      thinkingControl: true,
      samplingControl: true,
    },
    async invokeStructuredPrompt<T>(
      request: { operationName: string; prompt: LoadedPrompt; input: unknown },
    ): Promise<T> {
      recorder.structuredPromptCalls.push(`${label}:${request.operationName}`);
      return { label, operationName: request.operationName } as unknown as T;
    },
    async invokeStrictStructured<T>(
      request: { operationName: string; prompt: LoadedPrompt; input: unknown },
    ): Promise<T> {
      recorder.strictStructuredCalls.push(`${label}:${request.operationName}`);
      return { label, operationName: request.operationName } as unknown as T;
    },
  };
}

describe("tier-aware provider routing", () => {
  describe("operation tier routing", () => {
    it("routes smart operation to smart-tier inner provider", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      await provider.invokeStructuredPrompt({
        operationName: "topic.selector",
        prompt: { metadata: { id: "topic.selector" } } as unknown as LoadedPrompt,
        input: {},
      });

      expect(recorder.structuredPromptCalls).toEqual(["SMART:topic.selector"]);
      expect(recorder.strictStructuredCalls).toEqual([]);
    });

    it("routes flash operation to flash-tier inner provider", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      await provider.invokeStructuredPrompt({
        operationName: "publish.title-generator",
        prompt: { metadata: { id: "publish.title-generator" } } as unknown as LoadedPrompt,
        input: {},
      });

      expect(recorder.structuredPromptCalls).toEqual(["FLASH:publish.title-generator"]);
    });

    it("routes script.writer to smart (long creative output)", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      await provider.invokeStructuredPrompt({
        operationName: "script.writer",
        prompt: { metadata: { id: "script.writer" } } as unknown as LoadedPrompt,
        input: {},
      });

      expect(recorder.structuredPromptCalls).toEqual(["SMART:script.writer"]);
    });

    it("routes unknown operation to smart (conservative default)", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      await provider.invokeStructuredPrompt({
        operationName: "some.unknown.operation",
        prompt: { metadata: { id: "p" } } as unknown as LoadedPrompt,
        input: {},
      });

      expect(recorder.structuredPromptCalls).toEqual(["SMART:some.unknown.operation"]);
    });

    it("routes strict structured invocation by operation tier", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      // topic.selector 是 smart + tool_call，应走 smart strict
      await provider.invokeStrictStructured!({
        operationName: "topic.selector",
        prompt: { metadata: { id: "topic.selector" } } as unknown as LoadedPrompt,
        input: {},
        schema: { name: "tool", parameters: {} },
        parse: (x) => x,
        options: { strategy: "tool_call" },
      });

      expect(recorder.strictStructuredCalls).toEqual(["SMART:topic.selector"]);
    });
  });

  describe("provider capabilities passthrough", () => {
    it("exposes capabilities from smart provider (default for routing decisions)", async () => {
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: {
          capabilities: {
            jsonObject: true,
            toolCall: true,
            thinkingControl: true,
            samplingControl: false,
          },
        } as unknown as StructuredPromptProvider,
        flashProvider: {} as StructuredPromptProvider,
      });

      expect(provider.capabilities).toEqual({
        jsonObject: true,
        toolCall: true,
        thinkingControl: true,
        samplingControl: false,
      });
    });
  });

  describe("error propagation", () => {
    it("propagates inner provider errors without masking", async () => {
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const failingProvider: StructuredPromptProvider = {
        capabilities: {
          jsonObject: true,
          toolCall: true,
          thinkingControl: true,
          samplingControl: true,
        },
        async invokeStructuredPrompt() {
          throw new Error("inner_provider_failure");
        },
      };

      const provider = createTierAwareProvider({
        smartProvider: failingProvider,
        flashProvider: {} as StructuredPromptProvider,
      });

      await expect(
        provider.invokeStructuredPrompt({
          operationName: "topic.selector",
          prompt: { metadata: { id: "p" } } as unknown as LoadedPrompt,
          input: {},
        }),
      ).rejects.toThrow(/inner_provider_failure/);
    });
  });

  describe("factory validation", () => {
    it("throws when smartProvider is missing", async () => {
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      expect(() =>
        createTierAwareProvider({
          smartProvider: undefined as unknown as StructuredPromptProvider,
          flashProvider: {} as StructuredPromptProvider,
        }),
      ).toThrow(/smartProvider|smart_provider|missing/i);
    });

    it("throws when flashProvider is missing", async () => {
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      expect(() =>
        createTierAwareProvider({
          smartProvider: {} as StructuredPromptProvider,
          flashProvider: undefined as unknown as StructuredPromptProvider,
        }),
      ).toThrow(/flashProvider|flash_provider|missing/i);
    });
  });

  describe("tier routing decision logging (debuggability)", () => {
    it("does not crash when operationName is empty string", async () => {
      const recorder: StubInvokeRecorder = {
        structuredPromptCalls: [],
        strictStructuredCalls: [],
      };
      const { createTierAwareProvider } = await import(
        "../../../backend/src/runtime/llm/tier-aware-provider.js"
      );

      const provider = createTierAwareProvider({
        smartProvider: createRecordingStubProvider("SMART", recorder),
        flashProvider: createRecordingStubProvider("FLASH", recorder),
      });

      // 空 operationName 应默认走 smart（与 operation-tier-registry 一致）
      await provider.invokeStructuredPrompt({
        operationName: "",
        prompt: { metadata: { id: "p" } } as unknown as LoadedPrompt,
        input: {},
      });

      expect(recorder.structuredPromptCalls).toEqual(["SMART:"]);
    });
  });
});
