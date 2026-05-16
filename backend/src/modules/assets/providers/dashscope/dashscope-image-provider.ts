/**
 * DashScope image generation provider shell.
 *
 * Payload builder only; full provider adapter (AssetProviderAdapter) wired later.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

export interface DashScopeImageInput {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  n?: number;
}

export interface DashScopeImagePayload {
  model: string;
  input: {
    messages?: Array<{ role: string; content: Array<{ text: string }> }>;
    prompt?: string;
    negative_prompt?: string;
  };
  parameters: {
    size: string;
    n: number;
    negative_prompt?: string;
    prompt_extend?: boolean;
    watermark?: boolean;
  };
}

function isWan26Model(model: string): boolean {
  return /^wan2\.6/i.test(model.trim());
}

export function buildDashscopeImagePayload(
  input: DashScopeImageInput,
): DashScopeImagePayload {
  const model = input.model;
  const useWan26 = isWan26Model(model);
  const size = (input.size ?? "1080*1920").replace(/x/gi, "*");

  if (useWan26) {
    return {
      model,
      input: {
        messages: [{ role: "user", content: [{ text: input.prompt }] }],
      },
      parameters: {
        size,
        n: input.n ?? 1,
        negative_prompt: input.negativePrompt ?? "",
        prompt_extend: false,
        watermark: false,
      },
    };
  }

  return {
    model,
    input: {
      prompt: input.prompt,
      negative_prompt: input.negativePrompt ?? "低质量, 模糊, 变形, 水印, 文字",
    },
    parameters: { size, n: input.n ?? 1 },
  };
}
