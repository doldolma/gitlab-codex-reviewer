import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const distDir = resolve("dist");
const packageFile = join(distDir, "package.json");
if (existsSync(packageFile)) unlinkSync(packageFile);

for (const file of walk(distDir)) {
  if (!file.endsWith(".js")) continue;
  const before = readFileSync(file, "utf8");
  const after = before
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+?)(["'])/g, appendJsExtension)
    .replace(/(import\(\s*["'])(\.{1,2}\/[^"']+?)(["']\s*\))/g, appendJsExtension);
  if (after !== before) writeFileSync(file, after);
}

function appendJsExtension(_match, prefix, specifier, suffix) {
  if (/[./](?:js|json|node|css)$/.test(specifier)) return `${prefix}${specifier}${suffix}`;
  return `${prefix}${specifier}.js${suffix}`;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}
