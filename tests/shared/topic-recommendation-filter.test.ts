import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import {
  TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH,
  TOPIC_RECOMMENDATION_PERIOD_GROUPS,
  TopicRecommendationCentralActorType,
  TopicRecommendationEventDomain,
  TopicRecommendationFilterInputSchema,
  TopicRecommendationFilterSchema,
  TopicRecommendationStorytellingLens,
  expandTopicRecommendationPeriodRange,
  normalizeTopicRecommendationFilter,
} from "../../shared/src/index.js";

describe("TopicRecommendationFilter", () => {
  it("bundles the shared schema for a browser platform", async () => {
    await expect(
      build({
        bundle: true,
        entryPoints: [
          fileURLToPath(
            new URL(
              "../../shared/src/topic/topic-recommendation-filter.schema.ts",
              import.meta.url,
            ),
          ),
        ],
        external: ["zod"],
        format: "esm",
        logLevel: "silent",
        platform: "browser",
        write: false,
      }),
    ).resolves.toBeDefined();
  });

  it("locks the complete closed enum options", () => {
    expect(TopicRecommendationEventDomain.options).toEqual([
      "political_power",
      "military_warfare",
      "institutions_governance",
      "diplomacy_relations",
      "law_justice",
      "society_livelihood",
      "thought_culture",
    ]);
    expect(TopicRecommendationCentralActorType.options).toEqual([
      "ruler",
      "court_elite",
      "civil_official",
      "military_actor",
      "intellectual_actor",
      "religious_actor",
      "civilian",
      "collective",
    ]);
    expect(TopicRecommendationStorytellingLens.options).toEqual([
      "key_decision",
      "relationship_dynamics",
      "turning_point",
      "origins_analysis",
      "aftermath",
    ]);
  });

  it("keeps the fixed period group and period order", () => {
    expect(TOPIC_RECOMMENDATION_PERIOD_GROUPS).toEqual([
      {
        id: "ancient",
        periods: [
          { id: "xia_shang_western_zhou", label: "夏商西周" },
          { id: "spring_autumn", label: "春秋" },
          { id: "warring_states", label: "战国" },
          { id: "qin", label: "秦" },
          { id: "han", label: "两汉" },
        ],
      },
      {
        id: "medieval",
        periods: [
          { id: "three_kingdoms", label: "三国" },
          { id: "two_jin", label: "两晋" },
          { id: "southern_northern", label: "南北朝" },
          { id: "sui", label: "隋" },
          { id: "tang", label: "唐" },
          { id: "five_dynasties_ten_kingdoms", label: "五代十国" },
          { id: "song_liao_xia_jin", label: "宋辽夏金" },
        ],
      },
      {
        id: "late_imperial",
        periods: [
          { id: "yuan", label: "元" },
          { id: "ming", label: "明" },
          { id: "qing", label: "清" },
        ],
      },
    ]);
  });

  it("expands inclusive continuous ranges across intermediate periods", () => {
    expect(expandTopicRecommendationPeriodRange("two_jin", "tang")).toEqual([
      "two_jin",
      "southern_northern",
      "sui",
      "tang",
    ]);
    expect(
      expandTopicRecommendationPeriodRange("tang", "song_liao_xia_jin"),
    ).toEqual([
      "tang",
      "five_dynasties_ten_kingdoms",
      "song_liao_xia_jin",
    ]);
  });

  it("rejects unknown or reversed period endpoints", () => {
    expect(() =>
      expandTopicRecommendationPeriodRange("unknown", "tang"),
    ).toThrow(/unknown/i);
    expect(() =>
      expandTopicRecommendationPeriodRange("tang", "unknown"),
    ).toThrow(/unknown/i);
    expect(() =>
      expandTopicRecommendationPeriodRange("tang", "two_jin"),
    ).toThrow(/after/i);
  });

  it("rejects period endpoints from different parent groups", () => {
    expect(() =>
      expandTopicRecommendationPeriodRange("han", "three_kingdoms"),
    ).toThrow(/same period group/i);

    expect(() =>
      TopicRecommendationFilterInputSchema.parse({
        period_range: {
          start_id: "han",
          end_id: "three_kingdoms",
          included_period_ids: ["han", "three_kingdoms"],
        },
      }),
    ).toThrow();
  });

  it("accepts the fixed enums and a complete period range", () => {
    const input = {
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
      central_actor_type: "court_elite",
      storytelling_lens: "key_decision",
    } as const;

    expect(TopicRecommendationFilterInputSchema.parse(input)).toEqual(input);
    expect(TopicRecommendationFilterSchema.parse(input)).toEqual(input);
    expect(normalizeTopicRecommendationFilter(input)).toEqual(input);
  });

  it("rejects omitted, reordered, reversed, and unknown included periods", () => {
    const range = {
      start_id: "tang",
      end_id: "song_liao_xia_jin",
    };

    for (const included_period_ids of [
      ["tang", "song_liao_xia_jin"],
      ["tang", "song_liao_xia_jin", "five_dynasties_ten_kingdoms"],
      ["tang", "unknown", "song_liao_xia_jin"],
      [
        "tang",
        "five_dynasties_ten_kingdoms",
        "song_liao_xia_jin",
        "yuan",
      ],
    ]) {
      expect(() =>
        TopicRecommendationFilterSchema.parse({
          period_range: { ...range, included_period_ids },
        }),
      ).toThrow();
    }

    expect(() =>
      TopicRecommendationFilterSchema.parse({
        period_range: {
          start_id: "tang",
          end_id: "two_jin",
          included_period_ids: ["tang", "two_jin"],
        },
      }),
    ).toThrow();
  });

  it("allows auto only in input and normalizes no-op filters to undefined", () => {
    expect(
      TopicRecommendationFilterInputSchema.parse({ storytelling_lens: "auto" }),
    ).toEqual({ storytelling_lens: "auto" });
    expect(() =>
      TopicRecommendationFilterSchema.parse({ storytelling_lens: "auto" }),
    ).toThrow();

    expect(normalizeTopicRecommendationFilter({})).toBeUndefined();
    expect(
      normalizeTopicRecommendationFilter({ storytelling_lens: "auto" }),
    ).toBeUndefined();
    expect(
      normalizeTopicRecommendationFilter({ exclude_terms: [" ", "\t"] }),
    ).toBeUndefined();
  });

  it("trims, deduplicates, and sorts exclude terms without adding defaults", () => {
    expect(
      normalizeTopicRecommendationFilter({
        exclude_terms: [" 演义 ", "神话", "演义", "", "  "],
      }),
    ).toEqual({ exclude_terms: ["演义", "神话"] });

    expect(() =>
      TopicRecommendationFilterInputSchema.parse({
        exclude_terms: Array.from({ length: 9 }, (_, index) => `term-${index}`),
      }),
    ).toThrow();
  });

  it("collapses exclude-term whitespace before length checks and canonicalization", () => {
    const fortyCharacters = "x".repeat(40);

    expect(
      normalizeTopicRecommendationFilter({
        exclude_terms: [
          "神话  演义",
          " 神话\t演义 ",
          ` ${fortyCharacters} `,
        ],
      }),
    ).toEqual({
      exclude_terms: [fortyCharacters, "神话 演义"],
    });

    expect(() =>
      TopicRecommendationFilterSchema.parse({
        exclude_terms: ["神话  演义"],
      }),
    ).toThrow();
  });

  it("limits every raw and normalized exclude term to 40 characters", () => {
    const acceptedTerm = "x".repeat(40);
    const rejectedTerm = "x".repeat(41);

    expect(TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH).toBe(40);
    expect(
      TopicRecommendationFilterInputSchema.parse({
        exclude_terms: [acceptedTerm],
      }),
    ).toEqual({ exclude_terms: [acceptedTerm] });
    expect(
      TopicRecommendationFilterSchema.parse({
        exclude_terms: [acceptedTerm],
      }),
    ).toEqual({ exclude_terms: [acceptedTerm] });
    expect(() =>
      TopicRecommendationFilterInputSchema.parse({
        exclude_terms: [rejectedTerm],
      }),
    ).toThrow();
    expect(() =>
      TopicRecommendationFilterSchema.parse({
        exclude_terms: [rejectedTerm],
      }),
    ).toThrow();
    expect(
      normalizeTopicRecommendationFilter({
        exclude_terms: [` ${acceptedTerm} `],
      }),
    ).toEqual({ exclude_terms: [acceptedTerm] });
  });

  it("requires canonical exclude terms in the normalized schema", () => {
    expect(() =>
      TopicRecommendationFilterSchema.parse({
        exclude_terms: [" ", "演义", "演义"],
      }),
    ).toThrow();
    expect(() =>
      TopicRecommendationFilterSchema.parse({
        exclude_terms: ["神话", "演义"],
      }),
    ).toThrow();
    expect(
      TopicRecommendationFilterSchema.parse({
        exclude_terms: ["演义", "神话"],
      }),
    ).toEqual({ exclude_terms: ["演义", "神话"] });
  });

  it("trims input strings before producing the strict normalized contract", () => {
    expect(
      normalizeTopicRecommendationFilter({
        period_range: {
          start_id: " tang ",
          end_id: " song_liao_xia_jin ",
          included_period_ids: [
            " tang ",
            " five_dynasties_ten_kingdoms ",
            " song_liao_xia_jin ",
          ],
        },
        event_domain: " political_power ",
        central_actor_type: " court_elite ",
        storytelling_lens: " key_decision ",
      }),
    ).toEqual({
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
      central_actor_type: "court_elite",
      storytelling_lens: "key_decision",
    });
  });

  it("rejects invalid enum values and never accepts era_band", () => {
    expect(() =>
      TopicRecommendationFilterInputSchema.parse({ event_domain: "war" }),
    ).toThrow();
    expect(() =>
      TopicRecommendationFilterInputSchema.parse({ central_actor_type: "general" }),
    ).toThrow();
    expect(() =>
      TopicRecommendationFilterInputSchema.parse({ storytelling_lens: "conflict" }),
    ).toThrow();
    expect(() =>
      TopicRecommendationFilterInputSchema.parse({ era_band: "medieval" }),
    ).toThrow();
  });
});
