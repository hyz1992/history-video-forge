import imageSize from "image-size";
import { readFileSync } from "node:fs";

export interface ImageMetadata {
  width: number;
  height: number;
}

export function probeImageMetadata(filePath: string): ImageMetadata {
  const buffer = readFileSync(filePath);
  const result = imageSize(buffer);
  if (!result.width || !result.height) {
    throw new Error("image_dimensions_undetermined");
  }
  return { width: result.width, height: result.height };
}
