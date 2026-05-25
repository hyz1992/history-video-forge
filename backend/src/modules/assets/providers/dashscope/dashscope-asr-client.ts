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
      file_urls: [fileUrl],
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
  const uploadUrl = `${base}/compatible-mode/v1/uploads`;

  const policyResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-OssResourceResolve": "enable",
    },
    body: JSON.stringify({
      model: ASR_MODEL,
      file_name: fileName,
      file_size: fileBuffer.length,
    }),
  });

  if (!policyResponse.ok) {
    const text = await policyResponse.text();
    throw new Error(`DashScope upload policy failed: ${policyResponse.status} ${text}`);
  }

  const policy = (await policyResponse.json()) as {
    data: { upload_url: string; oss_url: string; request_id: string };
  };
  const uploadData = policy.data;

  if (!uploadData?.upload_url || !uploadData?.oss_url) {
    throw new Error(`Unexpected upload policy response: ${JSON.stringify(policy)}`);
  }

  const putResponse = await fetch(uploadData.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: fileBuffer,
  });

  if (!putResponse.ok) {
    throw new Error(`DashScope file PUT failed: ${putResponse.status}`);
  }

  return uploadData.oss_url;
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
