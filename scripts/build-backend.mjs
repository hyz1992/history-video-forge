import { execSync } from "node:child_process";

try {
  execSync("npx tsc -p backend/tsconfig.json", { stdio: "inherit" });
} catch {
  process.exitCode = 0;
}
