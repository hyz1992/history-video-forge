import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface BgmCatalog {
  generated_at?: string;
  items?: BgmCatalogItem[];
}

interface BgmCatalogItem {
  library_item_id?: string;
  type?: string;
  title?: string;
  status?: string;
  file_uri?: string;
  duration_sec?: number;
  tags?: string[];
  mood_tags?: string[];
  suitable_for?: string[];
  avoid_for?: string[];
  generation_priority?: number;
  audio_stats?: {
    rms_db?: number;
    peak_db?: number;
    clipped_ratio?: number;
    silent_ratio?: number;
  };
  quality_notes?: string[];
  volume_hint?: number;
  review?: {
    manual_decision?: string;
    notes?: string;
  };
}

export interface BgmAuditReport {
  schema_version: "bgm_quality_audit_report_v1";
  generated_at: string;
  source_catalog_path: string;
  summary: {
    total_generated_items: number;
    files_present: number;
    files_missing: number;
    pending_manual_review: number;
    loud_or_peak_risk_items: number;
  };
  items: BgmAuditItem[];
}

export interface BgmAuditItem {
  library_item_id: string;
  title: string;
  status: string;
  file_uri: string;
  file_exists: boolean;
  duration_sec: number | null;
  volume_hint: number | null;
  listen_priority: number | string;
  tags: string[];
  mood_tags: string[];
  suitable_for: string[];
  avoid_for: string[];
  audio_stats: {
    rms_db: number | null;
    peak_db: number | null;
    clipped_ratio: number | null;
    silent_ratio: number | null;
  };
  auto_flags: string[];
  quality_notes: string[];
  review: {
    manual_decision: string;
    notes: string;
  };
}

export async function auditBgmCatalog(input: {
  catalogPath: string;
  rootDir?: string;
  generatedAt?: string;
}): Promise<BgmAuditReport> {
  const catalog = JSON.parse(await readFile(input.catalogPath, "utf8")) as BgmCatalog;
  const rootDir = input.rootDir ?? process.cwd();
  const items = (catalog.items ?? [])
    .filter(isGeneratedBgmItem)
    .map((item, index) => buildAuditItem({ item, index, rootDir }));

  return {
    schema_version: "bgm_quality_audit_report_v1",
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source_catalog_path: input.catalogPath,
    summary: {
      total_generated_items: items.length,
      files_present: items.filter((item) => item.file_exists).length,
      files_missing: items.filter((item) => !item.file_exists).length,
      pending_manual_review: items.filter(
        (item) => item.review.manual_decision.length === 0,
      ).length,
      loud_or_peak_risk_items: items.filter((item) =>
        item.auto_flags.some(
          (flag) =>
            flag.includes("rms_db") ||
            flag.includes("峰值") ||
            flag.includes("削波"),
        ),
      ).length,
    },
    items,
  };
}

function buildAuditItem(input: {
  item: Required<Pick<BgmCatalogItem, "library_item_id" | "file_uri">> &
    BgmCatalogItem;
  index: number;
  rootDir: string;
}): BgmAuditItem {
  const { item, index, rootDir } = input;
  const audioStats = {
    rms_db: readNumberOrNull(item.audio_stats?.rms_db),
    peak_db: readNumberOrNull(item.audio_stats?.peak_db),
    clipped_ratio: readNumberOrNull(item.audio_stats?.clipped_ratio),
    silent_ratio: readNumberOrNull(item.audio_stats?.silent_ratio),
  };

  return {
    library_item_id: item.library_item_id,
    title: item.title ?? item.library_item_id,
    status: item.status ?? "",
    file_uri: item.file_uri,
    file_exists: existsSync(resolve(rootDir, item.file_uri)),
    duration_sec: readNumberOrNull(item.duration_sec),
    volume_hint: readNumberOrNull(item.volume_hint),
    listen_priority: item.generation_priority ?? index + 1,
    tags: item.tags ?? [],
    mood_tags: item.mood_tags ?? [],
    suitable_for: item.suitable_for ?? [],
    avoid_for: item.avoid_for ?? [],
    audio_stats: audioStats,
    auto_flags: buildAutoFlags({
      fileExists: existsSync(resolve(rootDir, item.file_uri)),
      audioStats,
    }),
    quality_notes: item.quality_notes ?? [],
    review: {
      manual_decision: item.review?.manual_decision ?? "",
      notes: item.review?.notes ?? "",
    },
  };
}

function buildAutoFlags(input: {
  fileExists: boolean;
  audioStats: BgmAuditItem["audio_stats"];
}): string[] {
  const flags: string[] = [];

  if (!input.fileExists) {
    flags.push("音频文件缺失");
  }
  if (input.audioStats.rms_db !== null && input.audioStats.rms_db > -14) {
    flags.push("rms_db偏高，做口播背景时要重点听是否抢人声");
  }
  if (input.audioStats.peak_db !== null && input.audioStats.peak_db > -0.5) {
    flags.push("峰值接近0dB，混音时要留意爆音或压缩感");
  }
  if (
    input.audioStats.clipped_ratio !== null &&
    input.audioStats.clipped_ratio > 0
  ) {
    flags.push("检测到少量削波风险");
  }
  if (
    input.audioStats.silent_ratio !== null &&
    input.audioStats.silent_ratio > 0.2
  ) {
    flags.push("静音占比较高，试听时确认是否有异常空段");
  }

  return flags;
}

function isGeneratedBgmItem(
  item: BgmCatalogItem,
): item is Required<Pick<BgmCatalogItem, "library_item_id" | "file_uri">> &
  BgmCatalogItem {
  return (
    item.type === "bgm" &&
    item.status === "generated_pending_review" &&
    typeof item.library_item_id === "string" &&
    item.library_item_id.length > 0 &&
    typeof item.file_uri === "string" &&
    item.file_uri.length > 0
  );
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCliArgs(argv: string[]): {
  catalogPath: string;
  outputPath: string | null;
} {
  let catalogPath = "storage/media-library/ai-bgm-prompt-candidates.json";
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--catalog" && next) {
      catalogPath = next;
      index += 1;
      continue;
    }
    if (current === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (!current.startsWith("--") && outputPath === null) {
      outputPath = current;
    }
  }

  return { catalogPath, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  auditBgmCatalog({
    catalogPath: resolve(process.cwd(), args.catalogPath),
    rootDir: process.cwd(),
  })
    .then((report) => {
      const content = `${JSON.stringify(report, null, 2)}\n`;
      if (args.outputPath) {
        writeFileSync(resolve(process.cwd(), args.outputPath), content, "utf8");
        return;
      }
      console.log(content);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
