import chalk from "chalk";
import type { ChannelConfig } from "../types.js";
import { loadConfig, saveConfig } from "../config.js";
import { normalizeHandle, probeFullDiskAccess, openFullDiskAccessPane } from "../channels/imessage.js";

export interface AddOpts {
  // telegram/discord: bot token
  token?: string;
  // telegram: sender allowlist id (numeric) | discord: channel id
  channelId?: string;
  // discord: sender allowlist id
  userId?: string;
  // imessage: phone number OR email address to allowlist. Repeatable.
  contact?: string[];
}

export async function cmdAdd(
  profile: string,
  kind: "telegram" | "discord" | "imessage",
  opts: AddOpts,
): Promise<void> {
  if (kind === "imessage") {
    return addIMessage(profile, opts);
  }
  return addTokenBased(profile, kind, opts);
}

async function addTokenBased(
  profile: string,
  kind: "telegram" | "discord",
  opts: AddOpts,
): Promise<void> {
  if (!opts.token) {
    throw new Error(`${kind}: --token is required`);
  }
  const cfg = loadConfig(profile);

  let entry: ChannelConfig;
  if (kind === "telegram") {
    // For telegram: `--channel-id` is the user's numeric Telegram id
    // (what @userinfobot returns). It lives in the allowlist - telegram
    // adapters route replies by chat id from the inbound message, not
    // a pre-set channel.
    const allowlist: (string | number)[] = [];
    const id = opts.channelId ?? opts.userId;
    if (id && /^\d+$/.test(id)) allowlist.push(Number(id));
    entry = { kind, token: opts.token, allowlist };
  } else {
    // For discord: `--channel-id` is the discord channel id; `--user-id`
    // is the sender to allow. Without a user id, no allowlist is
    // enforced (anyone in the channel can message the bot).
    const allowlist: (string | number)[] = opts.userId ? [opts.userId] : [];
    entry = { kind, token: opts.token, channelId: opts.channelId, allowlist };
  }

  cfg.channels = [...(cfg.channels ?? []).filter((c) => c.kind !== kind), entry];
  saveConfig(cfg);
  console.log(chalk.green(`✓ added ${kind} channel to ${profile}`));
  if (kind === "telegram" && (entry.allowlist?.length ?? 0) === 0) {
    console.log(chalk.yellow("  note: no user id provided - allowlist is empty (any user can message)"));
  }
}

async function addIMessage(profile: string, opts: AddOpts): Promise<void> {
  if (process.platform !== "darwin") {
    console.error(chalk.red(`✗ iMessage requires macOS (this platform: ${process.platform})`));
    process.exit(30);
  }
  const contacts = opts.contact ?? [];
  if (contacts.length === 0) {
    throw new Error("imessage: at least one --contact is required (phone number or email)");
  }
  const allowlist = contacts.map((c) => normalizeHandle(c));

  // Platform gate passed. Probe FDA and gently nudge the user toward
  // the Settings pane if it's missing - the adapter will fail to open
  // chat.db on first poll otherwise, so catching it here produces a
  // friendlier experience.
  const probe = probeFullDiskAccess();
  if (!probe.granted) {
    console.log(chalk.yellow(`! Full Disk Access not granted: ${probe.error}`));
    console.log(chalk.dim("  Opening System Settings so you can enable it..."));
    openFullDiskAccessPane();
    console.log(chalk.dim("  After granting, re-run this command or just start the daemon."));
  }

  const cfg = loadConfig(profile);
  const entry: ChannelConfig = { kind: "imessage", allowlist };
  cfg.channels = [...(cfg.channels ?? []).filter((c) => c.kind !== "imessage"), entry];
  saveConfig(cfg);
  console.log(chalk.green(`✓ added imessage channel to ${profile}`));
  console.log(chalk.dim(`  allowlist: ${allowlist.join(", ")}`));
  console.log(chalk.dim(`  run: bajaclaw daemon restart ${profile}`));
}

export async function cmdRemove(profile: string, kind: "telegram" | "discord" | "imessage"): Promise<void> {
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
    if (c.kind === "imessage") {
      const allow = (c.allowlist ?? []).map(String).join(", ") || "(empty - any handle)";
      console.log(`${chalk.bold(c.kind.padEnd(10))} contacts=${allow}`);
    } else {
      const tok = c.token ?? "";
      console.log(`${chalk.bold(c.kind.padEnd(10))} token=${tok.slice(0, 8)}${tok ? "..." : ""}${c.channelId ? `  channelId=${c.channelId}` : ""}`);
    }
  }
}
