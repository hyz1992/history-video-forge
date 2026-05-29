import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { probeImageMetadata } from "../../../backend/src/http/image-probe.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), ".test-image-probe");

// Minimal valid 1x1 PNG
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
  0x44, 0xAE, 0x42, 0x60, 0x82,
]);

describe("probeImageMetadata", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("探测 PNG 图片的宽高", () => {
    const filePath = join(TEST_DIR, "test.png");
    writeFileSync(filePath, MINIMAL_PNG);
    const meta = probeImageMetadata(filePath);
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });

  it("非图片文件抛出异常", () => {
    const filePath = join(TEST_DIR, "not-image.txt");
    writeFileSync(filePath, "hello world");
    expect(() => probeImageMetadata(filePath)).toThrow();
  });

  it("不存在的文件抛出异常", () => {
    expect(() => probeImageMetadata(join(TEST_DIR, "missing.png"))).toThrow();
  });
});
