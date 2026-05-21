import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader";
import {
  runRenderRuntimeSmoke,
  type RunRenderRuntimeSmokeInput,
  type RunRenderRuntimeSmokeResult,
} from "../runtime/render-runtime-smoke";

type BatchAdapter = "fake" | "remotion";
type BatchItemStatus = "succeeded" | "failed";

export interface BgmSmokeBatchReport {
  schema_version: "bgm_smoke_batch_report_v1";
  generated_at: string;
  source_catalog_path: string;
  output_dir: string;
  adapter: BatchAdapter;
  summary: {
    total_requested: number;
    succeeded: number;
    failed: number;
  };
  items: BgmSmokeBatchItem[];
}

export interface BgmSmokeBatchItem {
  library_item_id: string;
  status: BatchItemStatus;
  output_dir: string;
  output_file: string | null;
  volume_hint: number | null;
  error_message: string | null;
}

export async function renderBgmSmokeBatch(input: {
  catalogPath?: string;
  outputDir?: string;
  adapter?: BatchAdapter;
  limit?: number;
  runSmoke?: (
    input: RunRenderRuntimeSmokeInput,
  ) => Promise<RunRenderRuntimeSmokeResult>;
  generatedAt?: string;
}): Promise<BgmSmokeBatchReport> {
  const catalogPath = input.catalogPath ?? resolve(
    process.cwd(),
    "storage/media-library/ai-bgm-prompt-candidates.json",
  );
  const outputDir = input.outputDir ?? resolve(
    process.cwd(),
    "harness/scripts/runtime/output/bgm-smoke-batch",
  );
  const adapter = input.adapter ?? "remotion";
  const runSmoke = input.runSmoke ?? runRenderRuntimeSmoke;
  const loadedItems = await loadLightweightBgmCatalogItems(catalogPath);
  const selectedItems =
    typeof input.limit === "number" && input.limit >= 0
      ? loadedItems.slice(0, input.limit)
      : loadedItems;
  const items: BgmSmokeBatchItem[] = [];

  mkdirSync(outputDir, { recursive: true });

  for (const entry of selectedItems) {
    const libraryItemId = entry.item.library_item_id;
    const itemOutputDir = join(outputDir, libraryItemId);
    mkdirSync(itemOutputDir, { recursive: true });

    try {
      await runSmoke({
        adapter,
        outputDir: itemOutputDir,
        bgmLibraryItemId: libraryItemId,
      });
      items.push({
        library_item_id: libraryItemId,
        status: "succeeded",
        output_dir: itemOutputDir,
        output_file: readOutputFile(itemOutputDir),
        volume_hint: entry.volumeHint,
        error_message: null,
      });
    } catch (error) {
      items.push({
        library_item_id: libraryItemId,
        status: "failed",
        output_dir: itemOutputDir,
        output_file: null,
        volume_hint: entry.volumeHint,
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report: BgmSmokeBatchReport = {
    schema_version: "bgm_smoke_batch_report_v1",
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source_catalog_path: catalogPath,
    output_dir: outputDir,
    adapter,
    summary: {
      total_requested: items.length,
      succeeded: items.filter((item) => item.status === "succeeded").length,
      failed: items.filter((item) => item.status === "failed").length,
    },
    items,
  };

  writeFileSync(
    join(outputDir, "bgm-smoke-batch-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  return report;
}

export function parseBgmSmokeBatchCliArgs(argv: string[]): {
  adapter?: BatchAdapter;
  limit?: number;
  outputDir?: string;
  catalogPath?: string;
} {
  const result: {
    adapter?: BatchAdapter;
    limit?: number;
    outputDir?: string;
    catalogPath?: string;
  } = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--adapter" && next) {
      result.adapter = parseAdapter(next);
      index += 1;
      continue;
    }
    if (current.startsWith("--adapter=")) {
      result.adapter = parseAdapter(current.slice("--adapter=".length));
      continue;
    }
    if (current === "--limit" && next) {
      result.limit = parseLimit(next);
      index += 1;
      continue;
    }
    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--catalog" && next) {
      result.catalogPath = next;
      index += 1;
      continue;
    }
    if (!current.startsWith("--")) {
      positional.push(current);
    }
  }

  if (positional[0]) {
    result.adapter = parseAdapter(positional[0]);
  }
  if (positional[1]) {
    result.limit = parseLimit(positional[1]);
  }

  return result;
}

function readOutputFile(outputDir: string): string | null {
  const renderResponsePath = join(outputDir, "render-response.json");
  if (!existsSync(renderResponsePath)) {
    return null;
  }
  const renderResponse = JSON.parse(readFileSyncUtf8(renderResponsePath)) as {
    output_artifact?: { file_uri?: string };
  };
  return renderResponse.output_artifact?.file_uri ?? null;
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function parseAdapter(value: string): BatchAdapter {
  if (value === "fake" || value === "remotion") {
    return value;
  }
  throw new Error(`invalid_adapter: ${value}`);
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid_limit: ${value}`);
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseBgmSmokeBatchCliArgs(process.argv.slice(2));
  renderBgmSmokeBatch({
    adapter: args.adapter,
    limit: args.limit,
    outputDir: args.outputDir ? resolve(process.cwd(), args.outputDir) : undefined,
    catalogPath: args.catalogPath
      ? resolve(process.cwd(), args.catalogPath)
      : undefined,
  })
    .then((report) => {
      console.log(JSON.stringify(report.summary, null, 2));
      console.log(`report: ${join(report.output_dir, "bgm-smoke-batch-report.json")}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
