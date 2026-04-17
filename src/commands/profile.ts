import { readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { bajaclawHome } from "../paths.js";
import { runInit } from "./init.js";

export async function cmdList(): Promise<void> {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) { console.log(chalk.dim("no profiles.")); return; }
  for (const n of readdirSync(dir)) {
    if (existsSync(join(dir, n, "config.json"))) console.log(n);
  }
}

export async function cmdCreate(name: string, template: string): Promise<void> {
  await runInit({ name, template: template as never });
}

export async function cmdSwitch(name: string): Promise<void> {
  // Profile selection happens via --profile flag or BAJACLAW_PROFILE env var.
  // This command documents the mechanism.
  console.log(`To use profile "${name}":`);
  console.log(`  BAJACLAW_PROFILE=${name} bajaclaw start`);
  console.log(`  or: bajaclaw start ${name}`);
}

export async function cmdDelete(name: string, confirm = false): Promise<void> {
  const dir = join(bajaclawHome(), "profiles", name);
  if (!existsSync(dir)) { console.log(chalk.yellow(`${name} does not exist`)); return; }
  if (!confirm) {
    console.log(chalk.yellow(`This will delete ${dir} and all its data.`));
    console.log(`Re-run with --yes to confirm.`);
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(chalk.green(`✓ deleted ${name}`));
}
