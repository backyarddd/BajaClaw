import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { claudeDesktopConfigPath, profileDir, bajaclawHome, ensureDir } from "../paths.js";
import { loadConfig } from "../config.js";

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerEntry>;
}

export function readMcpFile(path: string): McpConfigFile {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as McpConfigFile; }
  catch (e) {
    process.stderr.write(`[warn] mcp config parse error in ${path}: ${(e as Error).message}\n`);
    return {};
  }
}

export function userMcpPath(): string {
  return join(bajaclawHome(), "mcp-config.json");
}

export function listConfigured(profile: string): Record<string, McpServerEntry> {
  const merged = mergeMcp(profile);
  return merged.mcpServers ?? {};
}

// Merge order (highest wins):
//   1. <profile>/agent-mcp-config.json
//   2. <profile>/mcp-config.json
//   3. ~/.bajaclaw/mcp-config.json (user-global BajaClaw MCP)
//   4. Desktop CLI MCP config - ONLY if mergeDesktopMcp: true in the profile.
//
// This keeps BajaClaw's MCP separate from the desktop CLI's by default.
// Use `bajaclaw mcp port` to copy servers from desktop into BajaClaw's scope,
// or set mergeDesktopMcp: true in config.json to auto-inherit.
export function mergeMcp(profile: string): McpConfigFile {
  const userFile = readMcpFile(userMcpPath());
  const profileFile = readMcpFile(join(profileDir(profile), "mcp-config.json"));
  const agentFile = readMcpFile(join(profileDir(profile), "agent-mcp-config.json"));

  let desktop: McpConfigFile = {};
  try {
    const cfg = loadConfig(profile) as { mergeDesktopMcp?: boolean };
    if (cfg.mergeDesktopMcp) desktop = readMcpFile(claudeDesktopConfigPath());
  } catch { /* profile may not exist yet */ }

  return {
    mcpServers: {
      ...(desktop.mcpServers ?? {}),
      ...(userFile.mcpServers ?? {}),
      ...(profileFile.mcpServers ?? {}),
      ...(agentFile.mcpServers ?? {}),
    },
  };
}

export function buildMcpConfig(profile: string): string {
  const merged = mergeMcp(profile);
  const dir = ensureDir(profileDir(profile));
  const path = join(dir, ".mcp-merged.json");
  writeFileSync(path, JSON.stringify(merged, null, 2));
  return path;
}

export function addServer(profile: string, name: string, entry: McpServerEntry): void {
  const path = join(profileDir(profile), "mcp-config.json");
  const current = readMcpFile(path);
  current.mcpServers = { ...(current.mcpServers ?? {}), [name]: entry };
  ensureDir(profileDir(profile));
  writeFileSync(path, JSON.stringify(current, null, 2));
}

export function removeServer(profile: string, name: string): boolean {
  const path = join(profileDir(profile), "mcp-config.json");
  const current = readMcpFile(path);
  if (!current.mcpServers?.[name]) return false;
  delete current.mcpServers[name];
  writeFileSync(path, JSON.stringify(current, null, 2));
  return true;
}
