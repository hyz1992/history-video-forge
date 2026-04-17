import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDir = resolve(process.cwd(), "harness/scripts/runtime/output");
mkdirSync(outputDir, { recursive: true });

const timestamp = new Date().toISOString();

writeFileSync(
  resolve(outputDir, "trace.md"),
  [
    "# topic-to-script runtime trace",
    "",
    `- generated_at: ${timestamp}`,
    "- status: not-wired",
    "- note: 当前仅为 harness v1 骨架，尚未接入真实 topic/script 运行链路。",
    "",
  ].join("\n"),
  "utf8",
);

writeFileSync(
  resolve(outputDir, "status.json"),
  JSON.stringify(
    {
      generatedAt: timestamp,
      status: "not-wired",
      stage: "harness-v1-skeleton",
    },
    null,
    2,
  ),
  "utf8",
);

console.log("runtime harness 骨架已运行，输出已写入 harness/scripts/runtime/output/ 。");

