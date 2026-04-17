import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function bajaclawHome(): string {
  return process.env.BAJACLAW_HOME ?? join(homedir(), ".bajaclaw");
}

export function claudeHome(): string {
  return process.env.CLAUDE_HOME ?? join(homedir(), ".claude");
}

export function profileDir(profile: string): string {
  return join(bajaclawHome(), "profiles", profile);
}

export function profileDb(profile: string): string {
  return join(profileDir(profile), "bajaclaw.db");
}

export function profileLogDir(profile: string): string {
  return join(profileDir(profile), "logs");
}

export function profileSkillsDir(profile: string): string {
  return join(profileDir(profile), "skills");
}

export function userSkillsDir(): string {
  return join(bajaclawHome(), "skills");
}

export function claudeAgentsDir(profile: string): string {
  return join(claudeHome(), "agents", profile);
}

export function claudeSkillsDir(): string {
  return join(claudeHome(), "skills");
}

export function claudeMemoryDir(): string {
  return join(claudeHome(), "memory");
}

export function claudeDesktopConfigPath(): string {
  const plat = platform();
  if (plat === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (plat === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
