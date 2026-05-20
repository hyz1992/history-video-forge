import { inflateSync } from "node:zlib";

import { expect } from "vitest";

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePngRgba(bytes: Uint8Array): DecodedPng {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...bytes.slice(0, 8)]).toEqual(pngSignature);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = textFromBytes(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkData = bytes.slice(dataStart, dataEnd);

    if (type === "IHDR") {
      width = readUint32(chunkData, 0);
      height = readUint32(chunkData, 4);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colorType);

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const sourceBytesPerPixel = colorType === 6 ? 4 : 3;
  const targetBytesPerPixel = 4;
  const scanlineLength = width * sourceBytesPerPixel;
  const data = new Uint8Array(width * height * targetBytesPerPixel);
  const sourceData = new Uint8Array(width * height * sourceBytesPerPixel);
  let inflatedOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[inflatedOffset]!;
    inflatedOffset += 1;
    const row = inflated.slice(inflatedOffset, inflatedOffset + scanlineLength);
    inflatedOffset += scanlineLength;
    const recon = sourceData.subarray(
      y * scanlineLength,
      (y + 1) * scanlineLength,
    );
    const previous =
      y === 0
        ? new Uint8Array(scanlineLength)
        : sourceData.subarray((y - 1) * scanlineLength, y * scanlineLength);

    unfilterScanline({
      filterType,
      row,
      previous,
      recon,
      bytesPerPixel: sourceBytesPerPixel,
    });
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * sourceBytesPerPixel;
    const targetOffset = pixel * targetBytesPerPixel;
    data[targetOffset] = sourceData[sourceOffset]!;
    data[targetOffset + 1] = sourceData[sourceOffset + 1]!;
    data[targetOffset + 2] = sourceData[sourceOffset + 2]!;
    data[targetOffset + 3] =
      sourceBytesPerPixel === 4 ? sourceData[sourceOffset + 3]! : 255;
  }

  return { width, height, data };
}

export function countBrightPixelsInBand(
  png: DecodedPng,
  band: { yMin: number; yMax: number },
) {
  return countPixelsInBand(png, band, ({ red, green, blue, alpha }) => {
    return red + green + blue > 600 && alpha > 0;
  });
}

export function countNonBlackPixelsInBand(
  png: DecodedPng,
  band: { yMin: number; yMax: number },
) {
  return countPixelsInBand(png, band, ({ red, green, blue, alpha }) => {
    return red + green + blue > 60 && alpha > 0;
  });
}

function countPixelsInBand(
  png: DecodedPng,
  band: { yMin: number; yMax: number },
  predicate: (pixel: {
    red: number;
    green: number;
    blue: number;
    alpha: number;
  }) => boolean,
) {
  let count = 0;
  const yMin = Math.max(0, band.yMin);
  const yMax = Math.min(png.height, band.yMax);

  for (let y = yMin; y < yMax; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      if (
        predicate({
          red: png.data[offset]!,
          green: png.data[offset + 1]!,
          blue: png.data[offset + 2]!,
          alpha: png.data[offset + 3]!,
        })
      ) {
        count += 1;
      }
    }
  }

  return count;
}

function unfilterScanline(input: {
  filterType: number;
  row: Uint8Array;
  previous: Uint8Array;
  recon: Uint8Array;
  bytesPerPixel: number;
}) {
  const { filterType, row, previous, recon, bytesPerPixel } = input;

  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? recon[index - bytesPerPixel]! : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
    let predictor = 0;

    if (filterType === 1) {
      predictor = left;
    } else if (filterType === 2) {
      predictor = up;
    } else if (filterType === 3) {
      predictor = Math.floor((left + up) / 2);
    } else if (filterType === 4) {
      predictor = paethPredictor(left, up, upLeft);
    } else if (filterType !== 0) {
      throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }

    recon[index] = (row[index]! + predictor) & 0xff;
  }
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function textFromBytes(bytes: Uint8Array) {
  return String.fromCharCode(...bytes);
}
