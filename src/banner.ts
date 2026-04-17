import chalk from "chalk";

export const ASCII_BANNER = String.raw`
 ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║
 ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║
 ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝`;

export const ASCII_MARK = [
  "     /\\    /\\",
  "    /  \\  /  \\",
  "   /    \\/    \\",
  "  /  /\\    /\\  \\",
  " /__/  \\__/  \\__\\",
].join("\n");

export const TAGLINE = "autonomous agents on your terms";

export function printBanner(version: string, opts: { force?: boolean } = {}): void {
  const out = process.stdout;
  if (!opts.force && !out.isTTY) return;
  const width = Math.max(process.stdout.columns ?? 80, 72);
  out.write(chalk.cyan(ASCII_BANNER) + "\n");
  const meta = ` v${version}   ${TAGLINE}`;
  out.write(chalk.dim(meta.padStart(Math.min(width, meta.length + 4))) + "\n\n");
}

export function printCompactBanner(version: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(
    chalk.cyan("▀▄  ") + chalk.bold("bajaclaw") + chalk.dim(`  v${version}  ·  ${TAGLINE}`) + "\n"
  );
}
