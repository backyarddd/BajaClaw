// Browser automation integration. Thin wrapper around the public
// `@playwright/mcp` package (runs via npx so there is no global
// install step). `enable` adds the MCP server to the profile's
// config, kicks off `npx playwright install chromium` to preload the
// browser binary, and that's it - the next cycle auto-discovers the
// browser_* tools via MCP and can use them immediately.
//
// Default args ship with sensible bells + whistles for autonomous
// agent use: headless (no popup), caps vision+pdf+storage
// (coordinate clicks as a ref-based fallback, PDF save, persistent
// cookies/localStorage), viewport 1280x800 for consistent snapshots.

import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { listConfigured, addServer, removeServer } from "../mcp/consumer.js";

export const BROWSER_MCP_NAME = "playwright";
export const DEFAULT_CAPS = ["vision", "pdf", "storage"] as const;
export const DEFAULT_VIEWPORT = "1280x800";

export interface BrowserEnableOpts {
  install?: boolean;
  headed?: boolean;
  caps?: string[];
  viewport?: string;
}

export function buildBrowserArgs(opts: { headed?: boolean; caps?: string[]; viewport?: string } = {}): string[] {
  const args: string[] = ["-y", "@playwright/mcp@latest"];
  if (!opts.headed) args.push("--headless");
  const caps = opts.caps ?? [...DEFAULT_CAPS];
  if (caps.length > 0) args.push("--caps", caps.join(","));
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  if (viewport) args.push("--viewport-size", viewport);
  return args;
}

export const BROWSER_MCP_SPEC = {
  command: "npx",
  args: buildBrowserArgs(),
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

export async function cmdBrowserEnable(profile: string, opts: BrowserEnableOpts = {}): Promise<void> {
  const args = buildBrowserArgs({ headed: opts.headed, caps: opts.caps, viewport: opts.viewport });
  addServer(profile, BROWSER_MCP_NAME, { command: "npx", args });
  console.log(chalk.green("✓ ") + `added '${BROWSER_MCP_NAME}' MCP server to '${profile}'`);
  console.log(chalk.dim(`  npx ${args.join(" ")}`));

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
  console.log(chalk.bold("Ready:"));
  const caps = opts.caps ?? [...DEFAULT_CAPS];
  console.log(chalk.dim(`  mode: ${opts.headed ? "headed" : "headless"}  viewport: ${opts.viewport ?? DEFAULT_VIEWPORT}  caps: ${caps.join(",")}`));
  console.log(chalk.dim("  tools exposed next cycle: browser_navigate, browser_click, browser_type,"));
  console.log(chalk.dim("  browser_snapshot, browser_evaluate, browser_file_upload, browser_tabs,"));
  if (caps.includes("pdf")) console.log(chalk.dim("  browser_pdf_save,"));
  if (caps.includes("vision")) console.log(chalk.dim("  browser_mouse_click_xy + coord clicks,"));
  if (caps.includes("storage")) console.log(chalk.dim("  browser_cookie_* + localStorage + persistent session,"));
  console.log(chalk.dim("  plus ~20 more."));
  console.log(chalk.dim("  try: bajaclaw chat -> 'open news.ycombinator.com and summarize top 5 stories'"));
}

export async function cmdBrowserDisable(profile: string): Promise<void> {
  const ok = removeServer(profile, BROWSER_MCP_NAME);
  console.log(ok
    ? chalk.green(`✓ disabled '${BROWSER_MCP_NAME}' for '${profile}'`)
    : chalk.yellow(`'${BROWSER_MCP_NAME}' was not enabled for '${profile}'`));
}
