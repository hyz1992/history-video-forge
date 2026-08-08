import { z } from "zod";

export const TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH = 40;

export const TOPIC_RECOMMENDATION_PERIOD_GROUPS = [
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
] as const;

type TopicRecommendationPeriodIdValue =
  (typeof TOPIC_RECOMMENDATION_PERIOD_GROUPS)[number]["periods"][number]["id"];

const TOPIC_RECOMMENDATION_PERIOD_IDS =
  TOPIC_RECOMMENDATION_PERIOD_GROUPS.flatMap((group) =>
    group.periods.map((period) => period.id),
  ) as [
    TopicRecommendationPeriodIdValue,
    ...TopicRecommendationPeriodIdValue[],
  ];

export const TopicRecommendationPeriodId = z.enum(
  TOPIC_RECOMMENDATION_PERIOD_IDS,
);

export const TopicRecommendationEventDomain = z.enum([
  "political_power",
  "military_warfare",
  "institutions_governance",
  "diplomacy_relations",
  "law_justice",
  "society_livelihood",
  "thought_culture",
]);

export const TopicRecommendationCentralActorType = z.enum([
  "ruler",
  "court_elite",
  "civil_official",
  "military_actor",
  "intellectual_actor",
  "religious_actor",
  "civilian",
  "collective",
]);

export const TopicRecommendationStorytellingLens = z.enum([
  "key_decision",
  "relationship_dynamics",
  "turning_point",
  "origins_analysis",
  "aftermath",
]);

export function expandTopicRecommendationPeriodRange(
  startId: string,
  endId: string,
): TopicRecommendationPeriodId[] {
  const startIndex = TOPIC_RECOMMENDATION_PERIOD_IDS.indexOf(
    startId as TopicRecommendationPeriodId,
  );
  const endIndex = TOPIC_RECOMMENDATION_PERIOD_IDS.indexOf(
    endId as TopicRecommendationPeriodId,
  );

  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Unknown topic recommendation period: ${startIndex < 0 ? startId : endId}`);
  }
  if (startIndex > endIndex) {
    throw new Error(`Topic recommendation period start ${startId} is after end ${endId}`);
  }

  return TOPIC_RECOMMENDATION_PERIOD_IDS.slice(startIndex, endIndex + 1);
}

const TopicRecommendationPeriodRangeSchema = z
  .object({
    start_id: TopicRecommendationPeriodId,
    end_id: TopicRecommendationPeriodId,
    included_period_ids: z.array(TopicRecommendationPeriodId).min(1),
  })
  .strict()
  .superRefine((range, context) => {
    let expected: TopicRecommendationPeriodId[];
    try {
      expected = expandTopicRecommendationPeriodRange(
        range.start_id,
        range.end_id,
      );
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid period range",
      });
      return;
    }

    if (
      expected.length !== range.included_period_ids.length ||
      expected.some((periodId, index) => periodId !== range.included_period_ids[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["included_period_ids"],
        message: "included_period_ids must exactly match the continuous period range",
      });
    }
  });

const TrimmedTopicRecommendationPeriodId = z
  .string()
  .transform((value) => value.trim())
  .pipe(TopicRecommendationPeriodId);

const TopicRecommendationPeriodRangeInputSchema = z
  .object({
    start_id: TrimmedTopicRecommendationPeriodId,
    end_id: TrimmedTopicRecommendationPeriodId,
    included_period_ids: z.array(TrimmedTopicRecommendationPeriodId).min(1),
  })
  .strict()
  .pipe(TopicRecommendationPeriodRangeSchema);

const trimInto = <T extends z.ZodTypeAny>(schema: T) =>
  z.string().transform((value) => value.trim()).pipe(schema);

const TopicRecommendationFilterInputFields = {
  period_range: TopicRecommendationPeriodRangeInputSchema.optional(),
  event_domain: trimInto(TopicRecommendationEventDomain).optional(),
  central_actor_type: trimInto(TopicRecommendationCentralActorType).optional(),
  exclude_terms: z
    .array(z.string().max(TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH))
    .max(8)
    .optional(),
};

const TopicRecommendationCanonicalExcludeTerms = z
  .array(
    z.string().min(1).max(TOPIC_RECOMMENDATION_EXCLUDE_TERM_MAX_LENGTH),
  )
  .max(8)
  .superRefine((terms, context) => {
    terms.forEach((term, index) => {
      if (term !== term.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "exclude term must be trimmed and non-empty",
        });
      }
    });

    if (new Set(terms).size !== terms.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exclude terms must not contain duplicates",
      });
    }

    const sorted = [...terms].sort();
    if (sorted.some((term, index) => term !== terms[index])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exclude terms must use the default string sort order",
      });
    }
  });

const TopicRecommendationFilterFields = {
  period_range: TopicRecommendationPeriodRangeSchema.optional(),
  event_domain: TopicRecommendationEventDomain.optional(),
  central_actor_type: TopicRecommendationCentralActorType.optional(),
  exclude_terms: TopicRecommendationCanonicalExcludeTerms.optional(),
};

export const TopicRecommendationFilterInputSchema = z
  .object({
    ...TopicRecommendationFilterInputFields,
    storytelling_lens: trimInto(
      z.union([TopicRecommendationStorytellingLens, z.literal("auto")]),
    ).optional(),
  })
  .strict();

export const TopicRecommendationFilterSchema = z
  .object({
    ...TopicRecommendationFilterFields,
    storytelling_lens: TopicRecommendationStorytellingLens.optional(),
  })
  .strict();

export function normalizeTopicRecommendationFilter(
  input: TopicRecommendationFilterInput,
): TopicRecommendationFilter | undefined {
  const parsed = TopicRecommendationFilterInputSchema.parse(input);
  const excludeTerms = parsed.exclude_terms
    ? [...new Set(parsed.exclude_terms.map((term) => term.trim()).filter(Boolean))].sort()
    : undefined;
  const normalized = TopicRecommendationFilterSchema.parse({
    ...(parsed.period_range ? { period_range: parsed.period_range } : {}),
    ...(parsed.event_domain ? { event_domain: parsed.event_domain } : {}),
    ...(parsed.central_actor_type
      ? { central_actor_type: parsed.central_actor_type }
      : {}),
    ...(parsed.storytelling_lens && parsed.storytelling_lens !== "auto"
      ? { storytelling_lens: parsed.storytelling_lens }
      : {}),
    ...(excludeTerms?.length ? { exclude_terms: excludeTerms } : {}),
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export type TopicRecommendationPeriodId = z.infer<
  typeof TopicRecommendationPeriodId
>;
export type TopicRecommendationEventDomain = z.infer<
  typeof TopicRecommendationEventDomain
>;
export type TopicRecommendationCentralActorType = z.infer<
  typeof TopicRecommendationCentralActorType
>;
export type TopicRecommendationStorytellingLens = z.infer<
  typeof TopicRecommendationStorytellingLens
>;
export type TopicRecommendationFilterInput = z.input<
  typeof TopicRecommendationFilterInputSchema
>;
export type TopicRecommendationFilter = z.infer<
  typeof TopicRecommendationFilterSchema
>;
