import fs from "node:fs/promises";
import path from "node:path";
import {
  submitDashscopeAsyncTask,
  pollDashscopeTask,
  downloadDashscopeOutput,
} from "./dashscope-client.js";
import type { AsrWord } from "../../asr-caption-aligner.js";

export interface DashScopeAsrOptions {
  apiKey: string;
  baseUrl?: string;
}

const ASR_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
export const ASR_MODEL = "qwen3-asr-flash-filetrans";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

export async function transcribeAudioFile(options: {
  apiKey: string;
  audioFilePath: string;
  baseUrl?: string;
}): Promise<AsrWord[]> {
  const fileUrl = await uploadLocalFile(options);

  const { taskId } = await submitDashscopeAsyncTask({
    apiKey: options.apiKey,
    endpoint: ASR_ENDPOINT,
    payload: buildAsrPayload(fileUrl),
    extraHeaders: { "X-DashScope-OssResourceResolve": "enable" },
  });

  const pollResult = await pollWithRetry({
    apiKey: options.apiKey,
    taskId,
  });

  if (pollResult.status !== "SUCCEEDED" || !pollResult.outputUrl) {
    throw new Error(
      `DashScope ASR failed: ${pollResult.errorCode} ${pollResult.errorMessage}`,
    );
  }

  const jsonBuffer = await downloadDashscopeOutput(pollResult.outputUrl);
  const transcription = JSON.parse(jsonBuffer.toString("utf-8"));

  return parseAsrWords(transcription);
}

export function buildAsrPayload(fileUrl: string): Record<string, unknown> {
  return {
    model: ASR_MODEL,
    input: {
      file_url: fileUrl,
    },
    parameters: {
      enable_words: true,
    },
  };
}

async function uploadLocalFile(options: {
  apiKey: string;
  audioFilePath: string;
  baseUrl?: string;
}): Promise<string> {
  const fileName = path.basename(options.audioFilePath);
  const fileBuffer = await fs.readFile(options.audioFilePath);

  const base = options.baseUrl ?? "https://dashscope.aliyuncs.com";

  // Step 1: Get upload policy
  const policyUrl = `${base}/api/v1/uploads?action=getPolicy&model=${ASR_MODEL}`;
  const policyResponse = await fetch(policyUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
  });

  if (!policyResponse.ok) {
    const text = await policyResponse.text();
    throw new Error(`DashScope upload policy failed: ${policyResponse.status} ${text}`);
  }

  const policyData = (await policyResponse.json()) as {
    data: {
      upload_dir: string;
      upload_host: string;
      oss_access_key_id: string;
      policy: string;
      signature: string;
      x_oss_object_acl: string;
      x_oss_forbid_overwrite: string;
    };
  };

  const { upload_dir, upload_host, oss_access_key_id, signature, policy, x_oss_object_acl, x_oss_forbid_overwrite } = policyData.data;

  if (!upload_dir || !upload_host || !oss_access_key_id || !policy || !signature) {
    throw new Error(`Unexpected upload policy response: ${JSON.stringify(policyData)}`);
  }

  // Step 2: Upload file to OSS via multipart/form-data
  const key = `${upload_dir}/${fileName}`;
  const formData = new FormData();
  formData.append("OSSAccessKeyId", oss_access_key_id);
  formData.append("Signature", signature);
  formData.append("policy", policy);
  formData.append("key", key);
  formData.append("x-oss-object-acl", x_oss_object_acl);
  formData.append("x-oss-forbid-overwrite", x_oss_forbid_overwrite);
  formData.append("success_action_status", "200");
  formData.append("file", new Blob([fileBuffer]), fileName);

  const uploadResponse = await fetch(upload_host, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`DashScope OSS upload failed: ${uploadResponse.status} ${text}`);
  }

  // Step 3: Construct oss:// URL
  return `oss://${key}`;
}

interface PollWithRetryResult {
  status: string;
  outputUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

async function pollWithRetry(options: {
  apiKey: string;
  taskId: string;
}): Promise<PollWithRetryResult> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const result = await pollDashscopeTask({
      apiKey: options.apiKey,
      taskId: options.taskId,
    });

    if (result.status === "SUCCEEDED" || result.status === "FAILED" || result.status === "CANCELED") {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`DashScope ASR polling timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}

interface AsrTranscriptionWord {
  text: string;
  begin_time: number;
  end_time: number;
  punctuation?: string;
}

export function parseAsrWords(transcription: unknown): AsrWord[] {
  const root = transcription as Record<string, unknown>;
  const transcripts = (root.transcripts ?? []) as Array<Record<string, unknown>>;

  const words: AsrWord[] = [];

  for (const transcript of transcripts) {
    const sentences = (transcript.sentences ?? []) as Array<Record<string, unknown>>;
    for (const sentence of sentences) {
      const sentenceWords = (sentence.words ?? []) as AsrTranscriptionWord[];
      for (const w of sentenceWords) {
        words.push({
          text: w.text,
          begin_time_ms: w.begin_time,
          end_time_ms: w.end_time,
          punctuation: w.punctuation ?? null,
        });
      }
    }
  }

  return words;
}
