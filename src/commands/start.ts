import chalk from "chalk";
import { runCycle } from "../agent.js";

export interface StartOptions {
  profile: string;
  task?: string;
  dryRun?: boolean;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const r = await runCycle({ profile: opts.profile, task: opts.task, dryRun: opts.dryRun });
  if (opts.dryRun || r.dryRun) {
    console.log(chalk.yellow("── dry-run ──"));
    console.log(chalk.dim("command:"), (r.command ?? []).join(" "));
    console.log(chalk.dim("prompt:"));
    console.log(r.prompt);
    return;
  }
  if (!r.ok) {
    console.error(chalk.red(`cycle ${r.cycleId} failed: ${r.error ?? "unknown"}`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✓ cycle ${r.cycleId} ok`), chalk.dim(`(${r.durationMs}ms${r.costUsd ? `, $${r.costUsd.toFixed(4)}` : ""})`));
  if (r.text) {
    console.log("");
    console.log(r.text.slice(0, 2000));
    if (r.text.length > 2000) console.log(chalk.dim(`… (${r.text.length - 2000} more chars)`));
  }
}
