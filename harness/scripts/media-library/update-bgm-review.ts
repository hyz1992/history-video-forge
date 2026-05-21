import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ReviewDecisionInput = "pass" | "reject" | "hold" | "clear";

interface BgmCatalog {
  items?: BgmCatalogItem[];
}

interface BgmCatalogItem {
  library_item_id?: string;
  review?: {
    manual_decision?: string;
    notes?: string;
  };
}

export interface UpdateBgmReviewResult {
  library_item_id: string;
  previous_decision: string;
  decision: string;
}

export async function updateBgmReview(input: {
  catalogPath: string;
  libraryItemId: string;
  decision: ReviewDecisionInput;
  notes?: string;
}): Promise<UpdateBgmReviewResult> {
  const catalog = JSON.parse(
    stripBom(await readFile(input.catalogPath, "utf8")),
  ) as BgmCatalog;
  const item = (catalog.items ?? []).find(
    (candidate) => candidate.library_item_id === input.libraryItemId,
  );

  if (!item) {
    throw new Error(`bgm_item_not_found: ${input.libraryItemId}`);
  }

  const previousDecision = item.review?.manual_decision ?? "";
  const nextDecision = input.decision === "clear" ? "" : input.decision;
  item.review = {
    ...(item.review ?? {}),
    manual_decision: nextDecision,
    notes: input.decision === "clear" ? "" : (input.notes ?? item.review?.notes ?? ""),
  };

  await writeFile(input.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  return {
    library_item_id: input.libraryItemId,
    previous_decision: previousDecision,
    decision: nextDecision,
  };
}

export function parseBgmReviewCliArgs(argv: string[]): {
  catalogPath: string;
  libraryItemId: string | null;
  decision: ReviewDecisionInput | null;
  notes?: string;
} {
  let catalogPath = "storage/media-library/ai-bgm-prompt-candidates.json";
  let libraryItemId: string | null = null;
  let decision: ReviewDecisionInput | null = null;
  let notes: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--catalog" && next) {
      catalogPath = next;
      index += 1;
      continue;
    }
    if (current === "--id" && next) {
      libraryItemId = next;
      index += 1;
      continue;
    }
    if (current === "--decision" && next) {
      decision = parseDecision(next);
      index += 1;
      continue;
    }
    if (current === "--notes" && next) {
      notes = next;
      index += 1;
      continue;
    }
    if (!current.startsWith("--")) {
      positional.push(current);
    }
  }

  if (positional.length > 0) {
    catalogPath = positional[0] ?? catalogPath;
    libraryItemId = positional[1] ?? libraryItemId;
    decision = positional[2] ? parseDecision(positional[2]) : decision;
    notes = positional[3] ?? notes;
  }

  return { catalogPath, libraryItemId, decision, notes };
}

function parseDecision(value: string): ReviewDecisionInput {
  if (
    value === "pass" ||
    value === "reject" ||
    value === "hold" ||
    value === "clear"
  ) {
    return value;
  }
  throw new Error(`invalid_decision: ${value}`);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseBgmReviewCliArgs(process.argv.slice(2));
  if (!args.libraryItemId || !args.decision) {
    console.error(
      "Usage: tsx harness/scripts/media-library/update-bgm-review.ts --id <library_item_id> --decision <pass|reject|hold|clear> [--notes <text>] [--catalog <path>]",
    );
    process.exitCode = 1;
  } else {
    updateBgmReview({
      catalogPath: resolve(process.cwd(), args.catalogPath),
      libraryItemId: args.libraryItemId,
      decision: args.decision,
      notes: args.notes,
    })
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
