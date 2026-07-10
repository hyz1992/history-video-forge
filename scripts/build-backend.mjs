import { execSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, resolve } from "node:path";

const DIST_DIR = "backend/dist";

export function runBackendBuild({
  distDir = DIST_DIR,
  exec = (command) => execSync(command, { stdio: "inherit" }),
} = {}) {
  rmSync(distDir, { recursive: true, force: true });
  exec("npx tsc -p backend/tsconfig.json");
  fixExtensionlessImports(distDir);
}

function fixExtensionlessImports(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      fixExtensionlessImports(fullPath);
    } else if (stat.isFile() && extname(entry) === ".js") {
      let content = readFileSync(fullPath, "utf8");
      let changed = false;

      content = content.replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
        (_match, prefix, path, suffix) => {
          if (path.endsWith(".js") || path.endsWith(".json")) {
            return prefix + path + suffix;
          }
          changed = true;
          return prefix + path + ".js" + suffix;
        },
      );

      if (changed) {
        writeFileSync(fullPath, content, "utf8");
      }
    }
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runBackendBuild();
}
