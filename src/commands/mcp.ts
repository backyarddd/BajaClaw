import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { claudeDesktopConfigPath, bajaclawHome, ensureDir } from "../paths.js";
import { listConfigured, addServer, removeServer } from "../mcp/consumer.js";
import { serve } from "../mcp/server.js";

export async function cmdList(profile: string): Promise<void> {
  const servers = listConfigured(profile);
  const names = Object.keys(servers);
  if (names.length === 0) {
    console.log(chalk.dim("no MCP servers configured."));
    return;
  }
  for (const n of names) {
    const s = servers[n]!;
    console.log(`${chalk.bold(n)}  ${s.command}${s.args?.length ? " " + s.args.join(" ") : ""}`);
  }
}

export async function cmdAdd(profile: string, name: string, command: string, args: string[] = [], env: Record<string, string> = {}): Promise<void> {
  addServer(profile, name, { command, args, env });
  console.log(chalk.green(`✓ added ${name}`));
}

export async function cmdRemove(profile: string, name: string): Promise<void> {
  const ok = removeServer(profile, name);
  console.log(ok ? chalk.green(`✓ removed ${name}`) : chalk.yellow(`${name} not present`));
}

export async function cmdServe(opts: { profile?: string; port?: number; stdio?: boolean }): Promise<void> {
  await serve(opts);
}

export async function cmdRegister(profile?: string): Promise<void> {
  const paths = [claudeDesktopConfigPath(), join(process.env.HOME ?? "", ".claude", "claude_desktop_config.json")];
  const bajaclawBin = process.execPath;
  const launcher = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "bin", "bajaclaw.js");
  const entry = {
    command: bajaclawBin,
    args: [launcher, "mcp", "serve", "--stdio"],
    env: profile ? { BAJACLAW_PROFILE: profile } : undefined,
  };
  for (const p of paths) {
    try {
      ensureDir(dirname(p));
      let cfg: { mcpServers?: Record<string, unknown> } = {};
      if (existsSync(p)) {
        try { cfg = JSON.parse(readFileSync(p, "utf8")); } catch { cfg = {}; }
      }
      cfg.mcpServers = { ...(cfg.mcpServers ?? {}), bajaclaw: entry };
      writeFileSync(p, JSON.stringify(cfg, null, 2));
      console.log(chalk.green(`✓ wrote ${p}`));
    } catch (e) {
      console.log(chalk.yellow(`skip ${p}: ${(e as Error).message}`));
    }
  }
  console.log(chalk.dim(`BajaClaw MCP server registered. Restart Claude Desktop to pick up changes.`));
  console.log(chalk.dim(`State dir: ${bajaclawHome()}`));
}
