import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";
import { profileDir, ensureDir } from "./paths.js";

const DEFAULT: Partial<AgentConfig> = {
  // "auto" picks haiku/sonnet/opus per task via src/model-picker.ts.
  // Override with a specific id to disable auto-selection.
  model: "auto",
  // `high` is the default so every cycle has real runway. Bump to
  // `xhigh` / `max` for monster tasks, drop to `low` / `medium` for
  // triage-only profiles. claude's internal turn budget scales with
  // this; there is no separate --max-turns flag.
  effort: "high",
  dashboardPort: 7337,
  dashboardAutostart: true,
  memorySync: false,
  // Default context window: 200k tokens (Sonnet/Haiku/Opus baseline).
  // Switch to `"1m"` here to opt into Opus's 1M window (API-key auth
  // only; CLI falls back to 200k for subscription users).
  contextWindow: "200k",
  // Mid-cycle narration level. "medium" narrates phase-changing events
  // (skills, searches, subagents, builds/tests, writes). "off" is silent
  // until the final reply. "full" narrates every tool call.
  verbosity: "medium",
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
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`config.json parse error in ${path}: ${(e as Error).message}`);
  }
  return { ...DEFAULT, ...(raw as object), profile } as AgentConfig;
}

export function saveConfig(cfg: AgentConfig): void {
  ensureDir(profileDir(cfg.profile));
  writeFileSync(configPath(cfg.profile), JSON.stringify(cfg, null, 2));
}

export function mergedDefaults(partial: Partial<AgentConfig>): AgentConfig {
  return { ...DEFAULT, ...partial } as AgentConfig;
}
