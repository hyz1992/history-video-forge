export interface SubtitleCueProp {
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface SubtitleStyleProp {
  style_id: string;
  font_family: string;
  font_size_px: number;
  font_weight: number;
  line_height: number;
  max_lines: number;
  text_color: string;
  stroke_color: string;
  stroke_width_px: number;
  shadow: string;
  background_color: string;
  background_opacity: number;
  position: "bottom" | "middle" | "top";
  horizontal_margin_px: number;
  bottom_margin_px: number;
  top_margin_px: number;
  safe_area_top_px: number;
  safe_area_bottom_px: number;
  max_width_pct: number;
  text_align: "left" | "center" | "right";
}

export interface TimelineVideoProps {
  timeline: unknown;
  assetManifest: unknown;
  assetBaseDir: string;
  width: number;
  height: number;
  fps: number;
  // Compatibility fallback: remove after all production callers use subtitleCues for one release cycle.
  subtitleText?: string;
  subtitleCues?: SubtitleCueProp[];
  subtitleStyle?: SubtitleStyleProp;
}
