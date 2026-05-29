import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { parseMultipart, type MultipartFile } from "../../../backend/src/http/multipart.js";

const require = createRequire(import.meta.url);

function makeMultipartRequest(boundary: string, body: Buffer): import("node:http").IncomingMessage {
  const { PassThrough } = require("node:stream") as typeof import("node:stream");
  const stream = new PassThrough();
  stream.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  stream.push(body);
  stream.push(null);
  return stream as unknown as import("node:http").IncomingMessage;
}

describe("parseMultipart", () => {
  it("解析单个文件字段", async () => {
    const boundary = "----TestBoundary";
    const fileContent = Buffer.from("fake image data");
    const body = Buffer.from(
      `------TestBoundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      `${fileContent.toString()}\r\n` +
      `------TestBoundary--\r\n`
    );
    const req = makeMultipartRequest(boundary, body);
    const result = await parseMultipart(req);
    expect(result.file).toBeDefined();
    expect(result.file!.originalName).toBe("test.png");
    expect(result.file!.mimeType).toBe("image/png");
    expect(result.file!.buffer.toString()).toBe(fileContent.toString());
    expect(result.file!.truncated).toBe(false);
  });

  it("空 body 返回 undefined file", async () => {
    const boundary = "----TestBoundary";
    const body = Buffer.from(`------TestBoundary--\r\n`);
    const req = makeMultipartRequest(boundary, body);
    const result = await parseMultipart(req);
    expect(result.file).toBeUndefined();
  });

  it("忽略非 file 字段", async () => {
    const boundary = "----TestBoundary";
    const body = Buffer.from(
      `------TestBoundary\r\n` +
      `Content-Disposition: form-data; name="other"\r\n\r\n` +
      `value\r\n` +
      `------TestBoundary--\r\n`
    );
    const req = makeMultipartRequest(boundary, body);
    const result = await parseMultipart(req);
    expect(result.file).toBeUndefined();
  });
});
