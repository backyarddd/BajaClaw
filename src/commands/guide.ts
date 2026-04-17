// `bajaclaw guide [topic]` — print a built-in self-setup skill as a
// walkthrough. Without a topic, lists all available guides.
//
// A "guide" is any skill whose name starts with `setup-`, `configure-`,
// or whose frontmatter has `guide: true`. Guides live alongside normal
// skills in the same scopes — so users can add their own without code
// changes.
import chalk from "chalk";
import { loadAllSkills } from "../skills/loader.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface GuideOptions {
  profile?: string;
}

export async function runGuide(
  topic: string | undefined,
  opts: GuideOptions = {},
): Promise<void> {
  const profile = opts.profile ?? process.env.BAJACLAW_PROFILE ?? "default";
  const all = loadAllSkills(profile);
  const guides = all.filter(isGuide);

  if (!topic) {
    console.log(chalk.bold("Available guides:"));
    console.log("");
    if (guides.length === 0) {
      console.log(chalk.dim("(none — check `bajaclaw skill list` for skills)"));
      return;
    }
    for (const g of guides) {
      const name = g.name.replace(/^(setup|configure)-/, "");
      console.log(`  ${chalk.cyan(name.padEnd(16))}  ${chalk.dim(g.description)}`);
    }
    console.log("");
    console.log(chalk.dim(`Read one: bajaclaw guide <topic>`));
    console.log(chalk.dim(`Or ask your agent directly: "help me ${guides[0]?.name.replace(/^(setup|configure)-/, "") ?? "telegram"}"`));
    return;
  }

  const normalized = topic.toLowerCase().replace(/\s+/g, "-");
  const match = guides.find((g) =>
    g.name === normalized ||
    g.name === `setup-${normalized}` ||
    g.name === `configure-${normalized}` ||
    g.name.includes(normalized),
  );

  if (!match) {
    console.error(chalk.red(`no guide found for "${topic}"`));
    console.log(chalk.dim(`run \`bajaclaw guide\` with no args to list available guides.`));
    process.exitCode = 1;
    return;
  }

  const body = readFileSync(join(match.path, "SKILL.md"), "utf8");
  console.log(chalk.bold(`── ${match.name} ──`));
  console.log(body);
  console.log("");
  console.log(chalk.dim(`(scope: ${match.scope}  path: ${match.path})`));
}

function isGuide(s: { name: string }): boolean {
  return s.name.startsWith("setup-") || s.name.startsWith("configure-");
}
