// File I/O for persona state. Separated from persona.ts so the renderer
// stays pure.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { profileDir, ensureDir } from "./paths.js";
import { renderSoul, type Persona } from "./persona.js";

export function personaPath(profile: string): string {
  return join(profileDir(profile), "persona.json");
}

export function soulPath(profile: string): string {
  return join(profileDir(profile), "SOUL.md");
}

export function loadPersona(profile: string): Persona | null {
  const p = personaPath(profile);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as Persona; }
  catch { return null; }
}

export function savePersona(profile: string, persona: Persona): void {
  ensureDir(profileDir(profile));
  writeFileSync(personaPath(profile), JSON.stringify(persona, null, 2));
  writeFileSync(soulPath(profile), renderSoul(persona));
}
