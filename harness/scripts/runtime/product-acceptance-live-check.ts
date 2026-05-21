import { resolve } from "node:path";

export interface ProductAcceptanceLiveCheckInput {
  sourceDir?: string;
  outputDir?: string;
  bgmLibraryItemId?: string;
  dashscope?: {
    apiKey?: string;
    baseUrl?: string;
    imageModel?: string;
    ttsModel?: string;
  };
  allowUpstreamGeneration?: boolean;
}

export interface ProductAcceptanceLiveCheckPlan {
  mode: "product_acceptance_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  source_dir: string | null;
  output_dir: string;
  disabled_providers: string[];
  disabled_task_types: string[];
  required_artifacts: string[];
  required_checks: string[];
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/product-acceptance-live-check",
);

export function buildProductAcceptanceLiveCheckPlan(
  input: ProductAcceptanceLiveCheckInput = {},
): ProductAcceptanceLiveCheckPlan {
  return {
    mode: "product_acceptance_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    source_dir: input.sourceDir ?? null,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    disabled_providers: ["dashscope_image_to_video"],
    disabled_task_types: ["video_clip", "sfx_cue"],
    required_artifacts: [
      "source-topic-package.json",
      "source-script-draft.json",
      "source-storyboard-plan.json",
      "asset-plan.json",
      "execution-asset-plan.json",
      "assets-response.json",
      "compose-response.json",
      "render-response.json",
      "acceptance-summary.json",
      "manual-review-checklist.md",
      "trace.md",
    ],
    required_checks: [
      "asset planning validation must pass",
      "manifest must contain dashscope_tts audio",
      "manifest must contain dashscope_image image",
      "manifest must contain local_subtitle subtitle_track",
      "render subtitle_cue_count must be greater than 0",
      "manifest must not contain sfx_audio",
      "provider list must not contain dashscope_image_to_video",
    ],
  };
}

export function parseProductAcceptanceLiveCheckCliArgs(
  argv: string[],
): ProductAcceptanceLiveCheckInput {
  const result: ProductAcceptanceLiveCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--source-dir" && next) {
      result.sourceDir = next;
      index += 1;
      continue;
    }

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current === "--bgm-id" && next) {
      result.bgmLibraryItemId = next;
      index += 1;
      continue;
    }

    if (current === "--dashscope-base-url" && next) {
      result.dashscope = { ...result.dashscope, baseUrl: next };
      index += 1;
      continue;
    }

    if (current === "--dashscope-image-model" && next) {
      result.dashscope = { ...result.dashscope, imageModel: next };
      index += 1;
      continue;
    }

    if (current === "--dashscope-tts-model" && next) {
      result.dashscope = { ...result.dashscope, ttsModel: next };
      index += 1;
      continue;
    }

    if (current === "--allow-upstream-generation") {
      result.allowUpstreamGeneration = true;
    }
  }

  return result;
}
