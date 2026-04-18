// Full teardown: stop daemons, remove scheduler entries, delete ~/.bajaclaw/,
// remove agent descriptors, remove MCP desktop entry, remove memory sync files.
// Requires --yes to execute. Idempotent.
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import {
  bajaclawHome,
  claudeAgentsDir,
  claudeDesktopConfigPath,
  claudeMemoryDir,
} from "../paths.js";
import { pickAdapter } from "../scheduler/index.js";

export interface UninstallOptions {
  yes?: boolean;
  keepData?: boolean;
}

export async function runUninstall(opts: UninstallOptions = {}): Promise<void> {
  const profiles = listProfiles();
  const plan = buildPlan(profiles, !!opts.keepData);

  console.log(chalk.bold("Uninstall plan:"));
  for (const line of plan.description) console.log(`  ${line}`);
  console.log("");

  if (!opts.yes) {
    console.log(chalk.yellow("Re-run with --yes to apply. Nothing has been changed."));
    return;
  }

  const errors: string[] = [];

  // 1. Stop running daemons by SIGTERM via pid files.
  for (const p of profiles) {
    const pidFile = join(bajaclawHome(), "profiles", p, "daemon.pid");
    if (!existsSync(pidFile)) continue;
    try {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
      unlinkSync(pidFile);
      console.log(chalk.green(`✓ stopped daemon for ${p} (pid ${pid})`));
    } catch (e) {
      errors.push(`daemon stop (${p}): ${(e as Error).message}`);
    }
  }

  // 2. Remove OS scheduler entries.
  const adapter = pickAdapter();
  for (const p of profiles) {
    try {
      await adapter.uninstall(p, "heartbeat");
      console.log(chalk.green(`✓ removed scheduler entry for ${p}`));
    } catch (e) {
      errors.push(`scheduler (${p}): ${(e as Error).message}`);
    }
  }

  // 3. Remove MCP entry from desktop config.
  try {
    const removed = removeMcpRegistration();
    if (removed.length > 0) {
      for (const path of removed) console.log(chalk.green(`✓ removed bajaclaw MCP entry from ${path}`));
    }
  } catch (e) {
    errors.push(`mcp unregister: ${(e as Error).message}`);
  }

  // 4. Remove agent descriptors.
  for (const p of profiles) {
    const dir = claudeAgentsDir(p);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        console.log(chalk.green(`✓ removed agent descriptor dir ${dir}`));
      } catch (e) {
        errors.push(`agent dir (${p}): ${(e as Error).message}`);
      }
    }
  }

  // 5. Remove memory sync files.
  const memDir = claudeMemoryDir();
  if (existsSync(memDir)) {
    for (const f of readdirSync(memDir)) {
      if (!f.startsWith("bajaclaw-") || !f.endsWith(".md")) continue;
      try {
        unlinkSync(join(memDir, f));
        console.log(chalk.green(`✓ removed sync file ${f}`));
      } catch (e) {
        errors.push(`memory file (${f}): ${(e as Error).message}`);
      }
    }
  }

  // 6. Remove ~/.bajaclaw/ (unless --keep-data).
  if (!opts.keepData) {
    const home = bajaclawHome();
    if (existsSync(home)) {
      try {
        rmSync(home, { recursive: true, force: true });
        console.log(chalk.green(`✓ removed ${home}`));
      } catch (e) {
        errors.push(`bajaclaw home: ${(e as Error).message}`);
      }
    }
  } else {
    console.log(chalk.dim(`kept data dir ${bajaclawHome()} (--keep-data)`));
  }

  if (errors.length > 0) {
    console.log("");
    console.log(chalk.yellow("Completed with warnings:"));
    for (const e of errors) console.log(chalk.yellow(`  ! ${e}`));
  }

  console.log("");
  console.log(chalk.green.bold("Uninstall complete."));
  console.log("");
  console.log(chalk.dim("To remove the bajaclaw command itself:"));
  console.log(chalk.dim("  npm uninstall -g bajaclaw"));
  console.log(chalk.dim("  (or `rm -rf` your git clone, if installed that way)"));
}

function listProfiles(): string[] {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, "config.json")));
}

function buildPlan(profiles: string[], keepData: boolean): { description: string[] } {
  const desc: string[] = [];
  if (profiles.length === 0) {
    desc.push(chalk.dim("no profiles found — nothing to tear down"));
  } else {
    desc.push(`${profiles.length} profile(s): ${profiles.join(", ")}`);
    desc.push("  · stop any running daemon");
    desc.push("  · remove OS scheduler entries (launchd/systemd/cron/schtasks)");
    desc.push("  · remove agent descriptor dir at ~/.claude/agents/<profile>/");
  }
  desc.push("remove bajaclaw MCP entry from desktop config");
  desc.push("remove memory sync files at ~/.claude/memory/bajaclaw-*.md");
  desc.push(
    keepData
      ? chalk.dim(`KEEP ~/.bajaclaw/ (data preserved)`)
      : chalk.yellow(`DELETE ~/.bajaclaw/ (irreversible: removes DBs, logs, skills, auto-candidates)`),
  );
  return { description: desc };
}

function removeMcpRegistration(): string[] {
  const paths = [
    claudeDesktopConfigPath(),
    join(process.env.HOME ?? "", ".claude", "claude_desktop_config.json"),
  ];
  const removed: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as { mcpServers?: Record<string, unknown> };
      if (cfg.mcpServers && "bajaclaw" in cfg.mcpServers) {
        delete cfg.mcpServers.bajaclaw;
        writeFileSync(p, JSON.stringify(cfg, null, 2));
        removed.push(p);
      }
    } catch { /* ignore unparseable configs */ }
  }
  return removed;
}
