// Port commands: move skills and MCP servers from the desktop CLI scope
// into BajaClaw's own scope. By design, nothing is auto-inherited.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import {
  portSkills,
  printPortReport,
  type PortDestination,
  type PortMode,
} from "../skills/porter.js";
import { claudeDesktopConfigPath, bajaclawHome, ensureDir } from "../paths.js";
import { userMcpPath, readMcpFile } from "../mcp/consumer.js";

export interface SkillPortOptions {
  source?: string;
  scope?: "user" | "profile" | "agent";
  profile?: string;
  link?: boolean;
  force?: boolean;
  names?: string[];
}

export async function cmdSkillPort(opts: SkillPortOptions): Promise<void> {
  const scope = opts.scope ?? "user";
  const destination: PortDestination =
    scope === "user"
      ? { scope: "user" }
      : scope === "profile"
        ? { scope: "profile", profile: requireProfile(opts.profile) }
        : { scope: "agent", profile: requireProfile(opts.profile) };
  const mode: PortMode = opts.link ? "link" : "copy";
  const report = await portSkills({
    source: opts.source,
    destination,
    mode,
    force: !!opts.force,
    names: opts.names,
  });
  printPortReport(report, mode);
}

export interface McpPortOptions {
  names?: string[];
  force?: boolean;
}

export async function cmdMcpPort(opts: McpPortOptions = {}): Promise<void> {
  const src = claudeDesktopConfigPath();
  if (!existsSync(src)) {
    console.log(chalk.yellow(`desktop MCP config not found at ${src}`));
    return;
  }
  const desktop = readMcpFile(src);
  const desktopServers = desktop.mcpServers ?? {};
  if (Object.keys(desktopServers).length === 0) {
    console.log(chalk.dim("desktop MCP config has no servers"));
    return;
  }

  ensureDir(bajaclawHome());
  const userMcp = readMcpFile(userMcpPath());
  const current = userMcp.mcpServers ?? {};

  const want = opts.names && opts.names.length > 0 ? new Set(opts.names) : null;
  const ported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const [name, entry] of Object.entries(desktopServers)) {
    if (want && !want.has(name)) continue;
    if (name === "bajaclaw") {
      skipped.push({ name, reason: "self-reference (BajaClaw's own MCP entry)" });
      continue;
    }
    if (current[name] && !opts.force) {
      skipped.push({ name, reason: "already present (use --force to overwrite)" });
      continue;
    }
    current[name] = entry;
    ported.push(name);
  }

  userMcp.mcpServers = current;
  writeFileSync(userMcpPath(), JSON.stringify(userMcp, null, 2));

  console.log(chalk.dim(`destination: ${userMcpPath()}`));
  for (const n of ported) console.log(chalk.green(`✓ ${n}`));
  for (const s of skipped) console.log(chalk.yellow(`- ${s.name}: ${s.reason}`));
  if (ported.length === 0 && skipped.length === 0) {
    console.log(chalk.dim("(nothing to port)"));
  }
}

function requireProfile(p: string | undefined): string {
  if (!p) {
    console.error(chalk.red("--profile <name> is required for scope=profile|agent"));
    process.exit(2);
  }
  return p;
}

// Read back what Claude has — useful for `bajaclaw mcp port --list`.
export function listDesktopServers(): string[] {
  const path = claudeDesktopConfigPath();
  if (!existsSync(path)) return [];
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
    return Object.keys(cfg.mcpServers ?? {});
  } catch { return []; }
}
