import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { profileDir, claudeAgentsDir, ensureDir } from "../paths.js";
import { saveConfig } from "../config.js";
import type { AgentConfig, Model, Effort } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = ["outreach", "research", "support", "social", "code", "custom"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export interface InitOptions {
  name: string;
  template?: TemplateName;
  model?: Model;
  effort?: Effort;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const template = opts.template ?? "custom";
  if (!TEMPLATES.includes(template as TemplateName)) {
    throw new Error(`unknown template: ${template}. Choose: ${TEMPLATES.join(", ")}`);
  }

  const dir = profileDir(opts.name);
  if (existsSync(dir) && !opts.force) {
    throw new Error(`Profile ${opts.name} already exists at ${dir}. Use --force to overwrite.`);
  }

  // Resolve the template dir before touching the filesystem — __dirname is
  // <repo>/src/commands (tsx) or <repo>/dist/commands (built); both resolve
  // the repo root with two parent hops.
  const tplDir = join(__dirname, "..", "..", "templates", template);
  if (!existsSync(tplDir)) throw new Error(`template missing: ${tplDir}`);

  ensureDir(dir);
  copyTemplateDir(tplDir, dir, { AGENT_NAME: opts.name, TEMPLATE: template });

  const cfg: AgentConfig = {
    name: opts.name,
    profile: opts.name,
    template,
    model: opts.model ?? "auto",
    effort: opts.effort ?? "medium",
    maxTurns: 20,
    dashboardPort: 7337,
    memorySync: false,
    allowedTools: defaultTools(template).allowed,
    disallowedTools: defaultTools(template).disallowed,
  };
  saveConfig(cfg);
  writeClaudeAgentMd(cfg);

  console.log(chalk.green(`✓ Scaffolded profile at ${dir}`));
  console.log(chalk.green(`✓ Wrote agent descriptor at ${claudeAgentsDir(opts.name)}/${opts.name}.md`));
  console.log("");
  console.log("Next:");
  console.log(`  bajaclaw doctor`);
  console.log(`  bajaclaw start ${opts.name} --dry-run`);
  console.log(`  bajaclaw mcp register ${opts.name}   # optional: expose BajaClaw as an MCP server`);
}

function copyTemplateDir(from: string, to: string, vars: Record<string, string>): void {
  if (!existsSync(from)) throw new Error(`template missing: ${from}`);
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const s = statSync(src);
    if (s.isDirectory()) {
      if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
      copyTemplateDir(src, dst, vars);
    } else {
      const raw = readFileSync(src, "utf8");
      const rendered = render(raw, vars);
      writeFileSync(dst, rendered);
    }
  }
}

function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function defaultTools(template: TemplateName): { allowed?: string[]; disallowed?: string[] } {
  // Tool restrictions are per-template soft defaults. Agents can edit
  // config.json afterwards to loosen or tighten. Only `code` keeps tight
  // restrictions by design — it's an orchestrator that delegates execution
  // to a sub-agent.
  switch (template) {
    case "code":
      return { allowed: ["Read", "Grep", "Glob"], disallowed: ["Write", "Edit", "Bash"] };
    case "outreach":
    case "research":
    case "support":
    case "social":
    case "custom":
    default:
      // No restrictions: full tool access (Read, Write, Edit, Bash, Grep,
      // Glob, WebSearch, WebFetch, and any MCP tools the user has configured).
      return {};
  }
}

function writeClaudeAgentMd(cfg: AgentConfig): void {
  // BajaClaw shares state with the user's CLI backend via ~/.claude/agents/.
  // The frontmatter below is a standard agent descriptor; the CLI picks it up
  // automatically so `@<name>` routing works in any tool that respects the
  // convention.
  const dir = ensureDir(claudeAgentsDir(cfg.profile));
  const body = `---
name: ${cfg.name}
description: BajaClaw agent (${cfg.template}) — autonomous, runs on heartbeat
model: ${cfg.model}
effort: ${cfg.effort}
maxTurns: ${cfg.maxTurns}
${cfg.disallowedTools ? `disallowedTools: [${cfg.disallowedTools.join(", ")}]\n` : ""}isolation: worktree
background: true
---

# ${cfg.name}

Paired BajaClaw profile: ~/.bajaclaw/profiles/${cfg.profile}/
Template: ${cfg.template}

Operating guide lives in AGENT.md of the profile directory.
`;
  writeFileSync(join(dir, `${cfg.name}.md`), body);
}
