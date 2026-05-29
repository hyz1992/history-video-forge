import Busboy from "busboy";
import type { IncomingMessage } from "node:http";

export interface MultipartFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  truncated: boolean;
}

export interface MultipartResult {
  file?: MultipartFile;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function parseMultipart(request: IncomingMessage): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: request.headers,
      limits: { fileSize: MAX_FILE_SIZE },
    });

    const result: MultipartResult = {};

    busboy.on("file", (name, stream, info) => {
      if (name !== "file") {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => { truncated = true; });
      stream.on("end", () => {
        result.file = {
          buffer: Buffer.concat(chunks),
          originalName: info.filename ?? "unknown",
          mimeType: info.mimeType ?? "application/octet-stream",
          truncated,
        };
      });
    });

    busboy.on("finish", () => resolve(result));
    busboy.on("error", reject);

    request.pipe(busboy);
  });
}
