// Browser automation integration. Thin wrapper around the public
// `@playwright/mcp` package (runs via npx so there is no global
// install step). `enable` adds the MCP server to the profile's
// config, kicks off `npx playwright install chromium` to preload the
// browser binary, and that's it - the next cycle auto-discovers the
// browser_* tools via MCP and can use them immediately.

import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { listConfigured, addServer, removeServer } from "../mcp/consumer.js";

export const BROWSER_MCP_NAME = "playwright";
export const BROWSER_MCP_SPEC = {
  command: "npx",
  args: ["-y", "@playwright/mcp@latest"],
} as const;

export async function cmdBrowserStatus(profile: string): Promise<void> {
  const servers = listConfigured(profile);
  if (servers[BROWSER_MCP_NAME]) {
    console.log(chalk.green("✓ ") + `browser tool enabled for '${profile}' via '${BROWSER_MCP_NAME}' MCP`);
    const s = servers[BROWSER_MCP_NAME]!;
    console.log(chalk.dim(`  ${s.command} ${(s.args ?? []).join(" ")}`));
  } else {
    console.log(chalk.dim(`browser tool not enabled for '${profile}'`));
    console.log(chalk.dim("enable: bajaclaw browser enable"));
  }
}

export async function cmdBrowserEnable(profile: string, opts: { install?: boolean } = {}): Promise<void> {
  addServer(profile, BROWSER_MCP_NAME, { command: BROWSER_MCP_SPEC.command, args: [...BROWSER_MCP_SPEC.args] });
  console.log(chalk.green("✓ ") + `added '${BROWSER_MCP_NAME}' MCP server to '${profile}'`);
  console.log(chalk.dim(`  ${BROWSER_MCP_SPEC.command} ${BROWSER_MCP_SPEC.args.join(" ")}`));

  if (opts.install !== false) {
    console.log("");
    console.log(chalk.dim("installing chromium (first run downloads ~150 MB)..."));
    const r = spawnSync("npx", ["-y", "playwright", "install", "chromium"], { stdio: "inherit" });
    if (r.error) {
      console.log(chalk.yellow(`could not run playwright install: ${r.error.message}`));
      console.log(chalk.yellow("install manually: npx playwright install chromium"));
    } else if (r.status !== 0) {
      console.log(chalk.yellow(`playwright install exited ${r.status}; run manually: npx playwright install chromium`));
    } else {
      console.log(chalk.green("✓ chromium ready"));
    }
  }

  console.log("");
  console.log(chalk.bold("Next:"));
  console.log(chalk.dim("  the agent will see browser_navigate, browser_click, browser_type, browser_snapshot"));
  console.log(chalk.dim("  on the next cycle. try: bajaclaw chat -> 'open news.ycombinator.com and summarize top 5 stories'"));
}

export async function cmdBrowserDisable(profile: string): Promise<void> {
  const ok = removeServer(profile, BROWSER_MCP_NAME);
  console.log(ok
    ? chalk.green(`✓ disabled '${BROWSER_MCP_NAME}' for '${profile}'`)
    : chalk.yellow(`'${BROWSER_MCP_NAME}' was not enabled for '${profile}'`));
}
