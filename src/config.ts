import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";
import { profileDir, ensureDir } from "./paths.js";

const DEFAULT: Partial<AgentConfig> = {
  // "auto" picks haiku/sonnet/opus per task via src/model-picker.ts.
  // Override with a specific id to disable auto-selection.
  model: "auto",
  effort: "medium",
  // Generous default so complex multi-command tasks (setup flows,
  // refactors, multi-file edits) complete without hitting the cap.
  // The tier budget in src/model-picker.ts is the actual ceiling;
  // this config is the floor.
  maxTurns: 30,
  dashboardPort: 7337,
  memorySync: false,
  compaction: {
    enabled: true,
    threshold: 0.75,
    schedule: "both",
    dailyAtUtc: "00:00",
    keepRecentPerKind: 25,
    pruneCycleDays: 30,
  },
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
