import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";

// Soft list. Any string is accepted — the backend CLI validates per
// subscription. Update as new ids ship.
export const KNOWN_MODELS = [
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

export interface ModelCmdOptions {
  profile?: string;
}

export async function runModel(
  value: string | undefined,
  opts: ModelCmdOptions = {},
): Promise<void> {
  const profile = opts.profile ?? process.env.BAJACLAW_PROFILE ?? "default";
  const cfg = loadConfig(profile);

  if (!value) {
    console.log(`profile: ${chalk.bold(profile)}`);
    console.log(`current: ${chalk.cyan(cfg.model)}`);
    console.log("");
    console.log(chalk.bold("known models:"));
    for (const m of KNOWN_MODELS) {
      const mark = m === cfg.model ? chalk.green("*") : " ";
      console.log(`  ${mark} ${m}`);
    }
    console.log("");
    console.log(chalk.dim("Any string is accepted; the backend validates against your subscription."));
    console.log(chalk.dim(`Set with: bajaclaw model <id> [profile]`));
    return;
  }

  const previous = cfg.model;
  cfg.model = value;
  saveConfig(cfg);
  console.log(chalk.green(`✓ ${profile}: model ${previous} → ${value}`));
}
