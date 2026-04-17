import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import type { AgentConfig, ChannelConfig } from "../types.js";
import { loadConfig, saveConfig } from "../config.js";

export async function cmdAdd(profile: string, kind: "telegram" | "discord", token: string, channelId?: string): Promise<void> {
  const cfg = loadConfig(profile);
  const entry: ChannelConfig = { kind, token, channelId, allowlist: [] };
  cfg.channels = [...(cfg.channels ?? []).filter((c) => c.kind !== kind), entry];
  saveConfig(cfg);
  console.log(chalk.green(`✓ added ${kind} channel to ${profile}`));
}

export async function cmdRemove(profile: string, kind: "telegram" | "discord"): Promise<void> {
  const cfg = loadConfig(profile);
  cfg.channels = (cfg.channels ?? []).filter((c) => c.kind !== kind);
  saveConfig(cfg);
  console.log(chalk.green(`✓ removed ${kind} channel from ${profile}`));
}

export async function cmdList(profile: string): Promise<void> {
  const cfg = loadConfig(profile);
  const chans = cfg.channels ?? [];
  if (chans.length === 0) { console.log(chalk.dim("no channels.")); return; }
  for (const c of chans) {
    console.log(`${chalk.bold(c.kind.padEnd(10))} token=${c.token.slice(0, 8)}…${c.channelId ? `  channelId=${c.channelId}` : ""}`);
  }
}
