#!/usr/bin/env node
// Copy non-TypeScript assets into dist/ so they ship in the npm
// tarball. Currently just `src/dashboard.html`, but add more entries
// here if other static files show up. Runs as part of `npm run build`.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const files = [
  { from: "src/dashboard.html", to: "dist/dashboard.html" },
];

for (const f of files) {
  const src = join(repoRoot, f.from);
  const dst = join(repoRoot, f.to);
  if (!existsSync(src)) {
    console.error(`[copy-static] skip ${f.from} (missing)`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.error(`[copy-static] ${f.from} -> ${f.to}`);
}
