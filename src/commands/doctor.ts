import chalk from "chalk";
import { runHealth } from "../health-check.js";
import { printBanner } from "../banner.js";
import { currentVersion } from "../updater.js";

export async function runDoctor(): Promise<void> {
  printBanner(currentVersion(), { force: true });
  const checks = await runHealth();
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`${mark} ${c.name.padEnd(28)} ${chalk.dim(c.detail)}`);
    if (!c.ok) failed++;
  }
  if (failed > 0) {
    console.log("");
    console.log(chalk.red(`${failed} check${failed === 1 ? "" : "s"} failed. See docs/claude-integration.md.`));
    process.exitCode = 1;
  } else {
    console.log("");
    console.log(chalk.green("All green."));
  }
}
