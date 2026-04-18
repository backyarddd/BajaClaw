import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";
import { profileDir, ensureDir } from "./paths.js";

const DEFAULT: Partial<AgentConfig> = {
  // "auto" picks haiku/sonnet/opus per task via src/model-picker.ts.
  // Override with a specific id to disable auto-selection.
  model: "auto",
  effort: "medium",
  // Capped low by default to keep token usage tight. Auto-picked tiers
  // further constrain turns per cycle. Bump explicitly for agents that
  // legitimately need long tool chains.
  maxTurns: 10,
  dashboardPort: 7337,
  memorySync: false,
};

export function configPath(profile: string): string {
  return join(profileDir(profile), "config.json");
}

export function loadConfig(profile: string): AgentConfig {
  const path = configPath(profile);
  if (!existsSync(path)) {
    throw new Error(`Profile not found: ${profile} (expected ${path}). Run \`bajaclaw init\`.`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { ...DEFAULT, ...raw, profile } as AgentConfig;
}

export function saveConfig(cfg: AgentConfig): void {
  ensureDir(profileDir(cfg.profile));
  writeFileSync(configPath(cfg.profile), JSON.stringify(cfg, null, 2));
}

export function mergedDefaults(partial: Partial<AgentConfig>): AgentConfig {
  return { ...DEFAULT, ...partial } as AgentConfig;
}
