import chalk from "chalk";
import { join } from "node:path";
import {
  loadSavedAnthropicKey,
  runSetupTokenInteractively,
  saveAnthropicKey,
} from "../api/anthropic-auth.js";
import { bajaclawHome } from "../paths.js";
import { confirm, isInteractive } from "../prompt.js";

function userApiConfigPath(): string {
  return join(bajaclawHome(), "api.json");
}

export interface SetupTokenOptions {
  force?: boolean;
}

export async function runSetupTokenCmd(opts: SetupTokenOptions = {}): Promise<void> {
  if (!isInteractive()) {
    console.error(chalk.red(
      "bajaclaw setup-token must be run on a TTY (it walks an OAuth browser flow)."
    ));
    process.exit(2);
  }

  const existing = loadSavedAnthropicKey();
  if (existing && !opts.force) {
    const masked = `${existing.slice(0, 8)}…${existing.slice(-4)}`;
    const yes = await confirm(
      `A token is already saved at ${userApiConfigPath()} (${masked}). Replace it?`,
      false,
    );
    if (!yes) {
      console.log(chalk.dim("kept existing token. exiting."));
      return;
    }
  }

  const minted = await runSetupTokenInteractively();
  if (!minted) {
    console.error(chalk.red("setup cancelled or no token captured."));
    process.exit(1);
  }

  try {
    saveAnthropicKey(minted);
  } catch (e) {
    console.error(chalk.red(`failed to save token: ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ token saved to ${userApiConfigPath()} (chmod 600).`));
  console.log(chalk.dim(`  bajaclaw serve will pick it up automatically on next start.`));
}
