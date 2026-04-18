import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import { KNOWN_MODELS as MODEL_TABLE } from "../model-picker.js";

export const KNOWN_MODELS = MODEL_TABLE.map((m) => m.id);

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
    console.log(chalk.bold("available:"));
    for (const m of MODEL_TABLE) {
      const mark = m.id === cfg.model ? chalk.green("*") : " ";
      const id = m.id === "auto" ? chalk.bold.yellow(m.id.padEnd(22)) : m.id.padEnd(22);
      console.log(`  ${mark} ${id} ${chalk.dim(m.note)}`);
    }
    console.log("");
    console.log(chalk.dim("Any backend model id is accepted; subscription validates."));
    console.log(chalk.dim(`Set with: bajaclaw model <id> [profile]`));
    return;
  }

  const previous = cfg.model;
  cfg.model = value;
  saveConfig(cfg);
  console.log(chalk.green(`✓ ${profile}: model ${previous} → ${value}`));
  if (value === "auto") {
    console.log(chalk.dim("  tasks will be routed to haiku / sonnet / opus based on shape"));
  }
}
