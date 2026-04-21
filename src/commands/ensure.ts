// `bajaclaw ensure <tool>` - the user-facing + skill-facing entry point.
//
// Exit code contract (used by shell callers inside skills):
//   0  ready              tool installed, and if --auth was asked, authed
//   10 install-failed     install was attempted but did not produce the bin
//   20 auth-pending       bin present, user must finish auth (browser/paste)
//   30 unsupported        no recipe for this OS
//   40 no-manager         we know how to install it but no package manager fit
//
// Human stderr output is progress-style; machine callers can use `--json`.
import chalk from "chalk";
import { detectPlatform, ensureTool, findRecipe, listRecipes, exitCodeFor } from "../ensure.js";

export interface RunEnsureOpts {
  auth?: boolean;
  quiet?: boolean;
  json?: boolean;
  checkOnly?: boolean;
}

export async function cmdEnsure(tool: string, opts: RunEnsureOpts = {}): Promise<void> {
  if (!opts.quiet && !opts.json) {
    const plat = detectPlatform();
    process.stderr.write(chalk.dim(`ensure: platform=${plat.os} managers=[${plat.managers.join(", ") || "none"}]\n`));
  }

  const outcome = await ensureTool(tool, {
    auth: opts.auth,
    quiet: opts.quiet || opts.json,
    checkOnly: opts.checkOnly,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ tool, ...outcome }) + "\n");
  } else {
    renderOutcome(tool, outcome);
  }
  process.exit(exitCodeFor(outcome));
}

export async function cmdEnsureList(opts: { json?: boolean } = {}): Promise<void> {
  const recipes = listRecipes();
  if (opts.json) {
    process.stdout.write(JSON.stringify(recipes.map((r) => ({
      name: r.name,
      describe: r.describe,
      bins: r.bins,
      hasAuth: !!r.authCheck,
      platforms: Object.keys(r.steps),
    })), null, 2) + "\n");
    return;
  }
  const plat = detectPlatform();
  console.log(chalk.bold(`\nensure: ${recipes.length} tools available\n`));
  for (const r of recipes) {
    const supported = plat.os in r.steps;
    const marker = supported ? chalk.green("●") : chalk.dim("○");
    const auth = r.authCheck ? chalk.dim("  auth") : "";
    console.log(`  ${marker} ${chalk.cyan(r.name.padEnd(12))} ${chalk.dim(r.describe)}${auth}`);
  }
  console.log(chalk.dim(`\nplatform: ${plat.os} | managers: ${plat.managers.join(", ") || "none detected"}\n`));
}

function renderOutcome(tool: string, outcome: Awaited<ReturnType<typeof ensureTool>>): void {
  switch (outcome.status) {
    case "ready":
      process.stderr.write(chalk.green(`✓ ${tool}: ${outcome.detail}\n`));
      return;
    case "install-failed":
      process.stderr.write(chalk.red(`✗ ${tool}: ${outcome.detail}\n`));
      if (outcome.recipe.docs) process.stderr.write(chalk.dim(`  docs: ${outcome.recipe.docs}\n`));
      return;
    case "auth-pending":
      process.stderr.write(chalk.yellow(`⧗ ${tool}: ${outcome.detail}\n`));
      return;
    case "unsupported":
      process.stderr.write(chalk.red(`✗ ${tool}: ${outcome.detail}\n`));
      return;
    case "no-manager":
      process.stderr.write(chalk.red(`✗ ${tool}: ${outcome.detail}\n`));
      return;
  }
}
