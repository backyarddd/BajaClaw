// Native credential store. No OpenClaw. Secrets live under <config>/auth/,
// one file per provider, mode 0600.
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { CONFIG_DIR } from "../config/config.mjs";

const AUTH_DIR = join(CONFIG_DIR, "auth");

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
