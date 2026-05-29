// Native credential store. No OpenClaw. Secrets live under ~/.bajaclaw/auth/,
// one file per provider, mode 0600.
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";

const DIR = process.env.BAJACLAW_HOME || join(homedir(), ".bajaclaw");
const AUTH_DIR = join(DIR, "auth");

function ensure() {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
}
function fileFor(provider) {
  return join(AUTH_DIR, `${provider}.json`);
}

export function saveCred(provider, data) {
  ensure();
  writeFileSync(fileFor(provider), JSON.stringify(data, null, 2), { mode: 0o600 });
  return fileFor(provider);
}

export function loadCred(provider) {
  const f = fileFor(provider);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

export function hasCred(provider) {
  return existsSync(fileFor(provider));
}

export function removeCred(provider) {
  const f = fileFor(provider);
  if (existsSync(f)) rmSync(f);
}

export function listAuthedProviders() {
  ensure();
  return readdirSync(AUTH_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export { AUTH_DIR };
