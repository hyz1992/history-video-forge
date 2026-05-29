import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileStream } from "../../../backend/src/http/file-response.js";
import { createServer, type Server, type ServerResponse, type IncomingMessage } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const TEST_DIR = join(process.cwd(), ".test-file-response");
const STORAGE_ROOT = join(TEST_DIR, "storage");

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res: any) => {
        const chunks: Buffer[] = [];
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") resHeaders[k] = v;
          else if (Array.isArray(v)) resHeaders[k] = v.join(", ");
        }
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: resHeaders, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("writeFileStream", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    mkdirSync(STORAGE_ROOT, { recursive: true });
    server = createServer((req, res) => {
      const url = new URL(req.url!, "http://127.0.0.1");
      const filePath = join(STORAGE_ROOT, url.pathname.slice(1));
      const mode = url.searchParams.get("mode");
      writeFileStream(res, filePath, STORAGE_ROOT, {
        disposition: mode === "attachment" ? "attachment" : "inline",
        filename: mode === "attachment" ? "output.mp4" : undefined,
      });
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("返回文件内容 + 正确 Content-Type", async () => {
    writeFileSync(join(STORAGE_ROOT, "test.png"), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));
    const { status, headers, body } = await request(port, "/test.png");
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("image/png");
    expect(headers["content-disposition"]).toContain("inline");
    expect(body.length).toBe(6);
  });

  it("attachment 模式设置 Content-Disposition", async () => {
    writeFileSync(join(STORAGE_ROOT, "video.mp4"), "fake video");
    const { status, headers } = await request(port, "/video.mp4?mode=attachment");
    expect(status).toBe(200);
    expect(headers["content-disposition"]).toBe('attachment; filename="output.mp4"');
    expect(headers["content-type"]).toBe("video/mp4");
  });

  it("不存在的文件返回 404", async () => {
    const { status, body } = await request(port, "/nonexistent.png");
    expect(status).toBe(404);
    expect(JSON.parse(body.toString()).error).toBe("file_not_found");
  });

  it("Range 请求返回 206", async () => {
    writeFileSync(join(STORAGE_ROOT, "test.mp4"), Buffer.alloc(100, 0xAA));
    const { status, headers, body } = await request(port, "/test.mp4", { range: "bytes=0-9" });
    expect(status).toBe(206);
    expect(headers["content-range"]).toBe("bytes 0-9/100");
    expect(parseInt(headers["content-length"]!)).toBe(10);
    expect(body.length).toBe(10);
  });
});

describe("writeFileStream 路径穿越（直接调用）", () => {
  beforeEach(() => {
    mkdirSync(STORAGE_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("路径穿越返回 403", () => {
    const { PassThrough } = require("node:stream") as typeof import("node:stream");
    const fakeReq = { headers: {} } as unknown as IncomingMessage;
    let statusCode = 0;
    let body = "";
    const res = {
      req: fakeReq,
      statusCode: 0,
      setHeader() {},
      end(data: string) { body = data; },
    } as unknown as ServerResponse;

    writeFileStream(res, resolve(STORAGE_ROOT, "../../etc/passwd"), STORAGE_ROOT);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(body).error).toBe("path_traversal_denied");
  });

  it("sibling prefix 绕过返回 403", () => {
    const siblingDir = join(TEST_DIR, "storage-other");
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, "evil.png"), "evil");

    const res = {
      req: { headers: {} } as unknown as IncomingMessage,
      statusCode: 0,
      setHeader() {},
      end(data: string) {},
    } as unknown as ServerResponse;

    writeFileStream(res, join(siblingDir, "evil.png"), STORAGE_ROOT);
    expect(res.statusCode).toBe(403);
  });
});
