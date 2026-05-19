import { describe, expect, it } from "vitest";

import { normalizeTtsPlanForExecution } from "../../../backend/src/modules/assets/tts-chunking.service.js";
import type { AssetPlan } from "../../../shared/src/index.js";

type TtsPlan = AssetPlan["tts_plan"];

function makeTtsPlan(
  chunks: TtsPlan["chunks"],
  overrides: Partial<Omit<TtsPlan, "chunks">> = {},
): TtsPlan {
  const estimatedTotal = chunks.reduce(
    (sum, chunk) => sum + chunk.estimated_duration_sec,
    0,
  );

  return {
    voice_profile_id: overrides.voice_profile_id ?? "voice_001",
    estimated_total_duration_sec:
      overrides.estimated_total_duration_sec ?? estimatedTotal,
    chunking_strategy: overrides.chunking_strategy ?? "segment_boundary",
    chunks,
  };
}

describe("normalizeTtsPlanForExecution", () => {
  it("keeps short chunks unchanged", () => {
    const ttsPlan = makeTtsPlan([
      {
        chunk_id: "chunk_1",
        order: 0,
        script_excerpt: "短句旁白。",
        estimated_duration_sec: 2,
      },
    ]);

    const result = normalizeTtsPlanForExecution({
      ttsPlan,
      maxCharsPerChunk: 20,
    });

    expect(result).toEqual(ttsPlan);
  });

  it("splits long chunks on sentence punctuation with stable derived ids", () => {
    const result = normalizeTtsPlanForExecution({
      ttsPlan: makeTtsPlan([
        {
          chunk_id: "chunk_1",
          order: 0,
          script_excerpt: "第一句很短。第二句也很短。第三句继续推进。",
          estimated_duration_sec: 12,
        },
      ]),
      maxCharsPerChunk: 8,
    });

    expect(result.chunks.map((chunk) => chunk.chunk_id)).toEqual([
      "chunk_1_part_1",
      "chunk_1_part_2",
      "chunk_1_part_3",
    ]);
    expect(result.chunks.map((chunk) => chunk.order)).toEqual([0, 1, 2]);
    expect(result.chunks.map((chunk) => chunk.script_excerpt)).toEqual([
      "第一句很短。",
      "第二句也很短。",
      "第三句继续推进。",
    ]);
    expect(
      result.chunks.reduce(
        (sum, chunk) => sum + chunk.estimated_duration_sec,
        0,
      ),
    ).toBeCloseTo(12, 5);
  });

  it("splits very long punctuation-free chunks by max characters", () => {
    const result = normalizeTtsPlanForExecution({
      ttsPlan: makeTtsPlan([
        {
          chunk_id: "chunk_1",
          order: 0,
          script_excerpt: "一二三四五六七八九十十一十二",
          estimated_duration_sec: 6,
        },
      ]),
      maxCharsPerChunk: 5,
    });

    expect(result.chunks.map((chunk) => chunk.script_excerpt)).toEqual([
      "一二三四五",
      "六七八九十",
      "十一十二",
    ]);
    expect(result.chunks.map((chunk) => chunk.chunk_id)).toEqual([
      "chunk_1_part_1",
      "chunk_1_part_2",
      "chunk_1_part_3",
    ]);
  });

  it("preserves plan-level fields and recomputes total estimated duration", () => {
    const result = normalizeTtsPlanForExecution({
      ttsPlan: makeTtsPlan(
        [
          {
            chunk_id: "chunk_1",
            order: 0,
            script_excerpt: "第一句很短。第二句也很短。",
            estimated_duration_sec: 9,
          },
        ],
        {
          voice_profile_id: "voice_custom",
          chunking_strategy: "sentence_boundary",
        },
      ),
      maxCharsPerChunk: 8,
    });

    expect(result.voice_profile_id).toBe("voice_custom");
    expect(result.chunking_strategy).toBe("sentence_boundary");
    expect(result.estimated_total_duration_sec).toBeCloseTo(
      result.chunks.reduce(
        (sum, chunk) => sum + chunk.estimated_duration_sec,
        0,
      ),
      5,
    );
  });
});
