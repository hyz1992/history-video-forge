import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const DIST_DIR = "backend/dist";

try {
  execSync("npx tsc -p backend/tsconfig.json", { stdio: "inherit" });
} catch {
  process.exitCode = 0;
}

fixExtensionlessImports(DIST_DIR);

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
