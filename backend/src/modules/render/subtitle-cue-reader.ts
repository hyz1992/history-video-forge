import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitleStyle,
} from "../../../../shared/src/index.js";
import type { z } from "zod";

export type SubtitleStyleValue = z.infer<typeof SubtitleStyle>;

export interface SubtitleCue {
  start_sec: number;
  end_sec: number;
  text: string;
}

export function normalizeSubtitleStyle(value: unknown): SubtitleStyleValue {
  const parsed = SubtitleStyle.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SUBTITLE_STYLE;
}

export function parseSubtitleCues(input: {
  format: "srt" | "vtt" | string;
  content: string;
}): SubtitleCue[] {
  const normalized = input.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("WEBVTT"));

    const timestampIndex = lines.findIndex((line) => line.includes("-->"));
    if (timestampIndex < 0) continue;

    const range = parseTimestampRange(lines[timestampIndex]!);
    if (!range) continue;

    const text = lines
      .slice(timestampIndex + 1)
      .filter((line) => !/^\d+$/.test(line))
      .join("\n");
    if (text.length === 0) continue;

    cues.push({
      start_sec: range.start_sec,
      end_sec: range.end_sec,
      text,
    });
  }

  return cues;
}

function parseTimestampRange(line: string):
  | { start_sec: number; end_sec: number }
  | null {
  const [startRaw, endAndSettingsRaw] = line.split(/\s+-->\s+/);
  if (!startRaw || !endAndSettingsRaw) return null;

  const endRaw = endAndSettingsRaw.trim().split(/\s+/)[0];
  const startSec = parseTimestampSec(startRaw.trim());
  const endSec = parseTimestampSec(endRaw.trim());
  if (startSec === null || endSec === null || endSec < startSec) return null;

  return { start_sec: startSec, end_sec: endSec };
}

function parseTimestampSec(value: string): number | null {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;

  const secondsPart = parts.at(-1);
  const minutesPart = parts.at(-2);
  const hoursPart = parts.length === 3 ? parts[0] : "0";
  if (!secondsPart || !minutesPart || hoursPart === undefined) return null;

  const seconds = Number(secondsPart);
  const minutes = Number(minutesPart);
  const hours = Number(hoursPart);
  if (![seconds, minutes, hours].every(Number.isFinite)) return null;
  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}
