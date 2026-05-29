import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let ffprobeAvailableCache: boolean | null = null;

export async function isFfprobeAvailable(): Promise<boolean> {
  if (ffprobeAvailableCache !== null) return ffprobeAvailableCache;
  try {
    await execFileAsync("ffprobe", ["-version"]);
    ffprobeAvailableCache = true;
  } catch {
    ffprobeAvailableCache = false;
  }
  return ffprobeAvailableCache;
}

export interface VideoMetadata {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
}

export async function probeVideoMetadata(filePath: string): Promise<VideoMetadata> {
  if (!(await isFfprobeAvailable())) {
    throw new Error("ffprobe_not_available");
  }
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
  if (!videoStream) {
    throw new Error("no_video_stream_found");
  }
  const fpsParts = (videoStream.r_frame_rate ?? "30/1").split("/");
  const fps = Math.round(parseInt(fpsParts[0]!, 10) / parseInt(fpsParts[1] ?? "1", 10));
  return {
    duration_sec: parseFloat(info.format?.duration ?? videoStream.duration ?? "0"),
    width: videoStream.width,
    height: videoStream.height,
    fps: fps || 30,
  };
}
