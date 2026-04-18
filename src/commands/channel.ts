import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import type { AgentConfig, ChannelConfig } from "../types.js";
import { loadConfig, saveConfig } from "../config.js";

export async function cmdAdd(
  profile: string,
  kind: "telegram" | "discord",
  token: string,
  channelId?: string,
  userId?: string,
): Promise<void> {
  const cfg = loadConfig(profile);

  // For telegram: `--channel-id` is the user's numeric Telegram id
  //   (the same thing @userinfobot returns). It lives in the allowlist,
  //   not channelId — telegram adapters route replies by chat id from
  //   the inbound message, not a pre-set channel.
  // For discord: `--channel-id` is the discord channel id; `--user-id`
  //   is the sender to allow. Without a user id, no allowlist is
  //   enforced (anyone in the channel can message the bot).
  let entry: ChannelConfig;
  if (kind === "telegram") {
    const allowlist: (string | number)[] = [];
    const id = channelId ?? userId;
    if (id && /^\d+$/.test(id)) allowlist.push(Number(id));
    entry = { kind, token, allowlist };
  } else {
    const allowlist: (string | number)[] = userId ? [userId] : [];
    entry = { kind, token, channelId, allowlist };
  }

  cfg.channels = [...(cfg.channels ?? []).filter((c) => c.kind !== kind), entry];
  saveConfig(cfg);
  console.log(chalk.green(`✓ added ${kind} channel to ${profile}`));
  if (kind === "telegram" && entry.allowlist?.length === 0) {
    console.log(chalk.yellow("  note: no user id provided — allowlist is empty (any user can message)"));
  }
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
