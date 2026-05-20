import { DEFAULT_SUBTITLE_STYLE } from "../../shared/src/index";
import type { CSSProperties } from "react";

import type { SubtitleCueProp, SubtitleStyleProp } from "./timeline-props";

export const DEFAULT_SUBTITLE_STYLE_PROP: SubtitleStyleProp =
  DEFAULT_SUBTITLE_STYLE;

export function getActiveSubtitleCue(input: {
  cues: SubtitleCueProp[];
  frame: number;
  fps: number;
}): SubtitleCueProp | null {
  const currentSec = input.frame / input.fps;
  return (
    input.cues.find(
      (cue) => currentSec >= cue.start_sec && currentSec < cue.end_sec,
    ) ?? null
  );
}

export function makeSubtitleContainerStyle(input: {
  frameWidth: number;
  frameHeight: number;
  style: SubtitleStyleProp;
}): CSSProperties {
  const style = input.style;
  const horizontalMargin = clamp(style.horizontal_margin_px, 0, input.frameWidth / 3);
  const maxWidthPct = clamp(style.max_width_pct, 0.4, 1);
  const base: CSSProperties = {
    position: "absolute",
    left: horizontalMargin,
    right: horizontalMargin,
    maxWidth: `${Math.round(maxWidthPct * 100)}%`,
    marginLeft: "auto",
    marginRight: "auto",
    color: style.text_color,
    fontFamily: style.font_family,
    fontSize: clamp(style.font_size_px, 18, 96),
    fontWeight: style.font_weight,
    lineHeight: style.line_height,
    textAlign: style.text_align,
    textShadow: style.shadow,
    WebkitTextStroke: `${style.stroke_width_px}px ${style.stroke_color}`,
    backgroundColor: rgbaFromHex(style.background_color, style.background_opacity),
    display: "-webkit-box",
    WebkitLineClamp: style.max_lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "break-word",
    padding: style.background_opacity > 0 ? "8px 12px" : undefined,
  };

  if (style.position === "top") {
    return {
      ...base,
      top: Math.max(style.top_margin_px, style.safe_area_top_px),
    };
  }

  if (style.position === "middle") {
    return {
      ...base,
      top: Math.max(style.safe_area_top_px, Math.round(input.frameHeight / 2)),
      transform: "translateY(-50%)",
    };
  }

  return {
    ...base,
    bottom: Math.max(style.bottom_margin_px, style.safe_area_bottom_px),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbaFromHex(color: string, opacity: number): string {
  if (opacity <= 0) return "transparent";
  const hex = color.replace("#", "");
  if (!/^[\da-fA-F]{6}$/.test(hex)) return color;

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
}
