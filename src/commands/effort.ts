import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import type { Effort } from "../types.js";

export const EFFORT_LEVELS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface EffortCmdOptions {
  profile?: string;
}

export async function runEffort(
  value: string | undefined,
  opts: EffortCmdOptions = {},
): Promise<void> {
  const profile = opts.profile ?? process.env.BAJACLAW_PROFILE ?? "default";
  const cfg = loadConfig(profile);

  if (!value) {
    console.log(`profile: ${chalk.bold(profile)}`);
    console.log(`current: ${chalk.cyan(cfg.effort)}`);
    console.log("");
    console.log(chalk.bold("levels:"));
    for (const l of EFFORT_LEVELS) {
      const mark = l === cfg.effort ? chalk.green("*") : " ";
      const hint = l === "low" ? "(fast, cheap - triage)"
        : l === "medium" ? "(balanced)"
        : l === "high" ? "(default - ample runway for most work)"
        : l === "xhigh" ? "(more turns + tokens - complex multi-step tasks)"
        : "(maximum - unleash the agent, highest cost)";
      console.log(`  ${mark} ${l.padEnd(8)} ${chalk.dim(hint)}`);
    }
    console.log("");
    console.log(chalk.dim(`Set with: bajaclaw effort <level> [profile]`));
    return;
  }

  if (!EFFORT_LEVELS.includes(value as Effort)) {
    console.error(chalk.red(`unknown effort level: ${value}. Valid: ${EFFORT_LEVELS.join(", ")}`));
    process.exitCode = 1;
    return;
  }

  const previous = cfg.effort;
  cfg.effort = value as Effort;
  saveConfig(cfg);
  console.log(chalk.green(`✓ ${profile}: effort ${previous} → ${value}`));
}
