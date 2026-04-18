import chalk from "chalk";
import { check, currentVersion, newerAvailable, performUpdate, detectInstall } from "../updater.js";

export interface UpdateCmdOptions {
  check?: boolean;
  force?: boolean;
  yes?: boolean;
}

export async function runUpdate(opts: UpdateCmdOptions = {}): Promise<void> {
  const info = await check({ force: true });
  if (!info) {
    console.error(chalk.red("update check failed (network unavailable?)"));
    process.exitCode = 1;
    return;
  }
  const loc = detectInstall();
  console.log(`installed: ${chalk.bold(info.current)}   (${loc.kind})`);
  console.log(`latest:    ${chalk.bold(info.latest ?? "unknown")}`);

  if (!newerAvailable(info)) {
    console.log(chalk.green("already up to date."));
    return;
  }
  if (opts.check) {
    console.log(chalk.yellow(`update available: ${info.current} → ${info.latest}`));
    return;
  }
  if (!opts.yes) {
    console.log("");
    console.log(`Update will run: ${chalk.dim(loc.kind === "git" ? "git pull + npm install + npm run build" : "npm install -g bajaclaw@latest")}`);
    console.log(chalk.yellow("re-run with --yes to apply."));
    return;
  }

  console.log(chalk.cyan("updating…"));
  const r = await performUpdate(info);
  if (r.ok) {
    console.log(chalk.green(`✓ ${r.message}`));
  } else {
    console.error(chalk.red(`✗ ${r.method}: ${r.message}`));
    process.exitCode = 1;
  }
}

export async function maybeNoticeAtExit(): Promise<void> {
  try {
    const info = await check();
    if (info && newerAvailable(info)) {
      // Import lazily to keep startup light if not needed.
      const { printNotice } = await import("../updater.js");
      printNotice(info);
    }
  } catch { /* silent */ }
  void currentVersion;
}
