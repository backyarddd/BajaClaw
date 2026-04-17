#!/usr/bin/env node
// Thin launcher — resolves tsx and invokes src/cli.ts, or dist/cli.js if built.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const built = join(root, "dist", "cli.js");
const src = join(root, "src", "cli.ts");

const args = process.argv.slice(2);

if (existsSync(built)) {
  const r = spawnSync(process.execPath, [built, ...args], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

// Dev path: find tsx in common locations
const tsxCandidates = [
  join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
  join(root, "..", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
];

let tsx = null;
for (const c of tsxCandidates) if (existsSync(c)) { tsx = c; break; }

if (!tsx) {
  console.error("bajaclaw: build missing and tsx not found. Run `npm install` then `npm run build`.");
  process.exit(1);
}

const r = spawnSync(tsx, [src, ...args], { stdio: "inherit", shell: tsx.endsWith(".cmd") });
process.exit(r.status ?? 1);
