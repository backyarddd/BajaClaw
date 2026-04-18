// `bajaclaw persona [profile]` — view or re-run the persona wizard.
import chalk from "chalk";
import { loadPersona, savePersona, personaPath, soulPath } from "../persona-io.js";
import { renderSoul, TONE_OPTIONS, type Persona } from "../persona.js";
import { ask, askChoice, askList, detectTimezone } from "../prompt.js";
import { DEFAULT_PROFILE_NAME } from "./setup.js";

export interface PersonaCmdOptions {
  profile?: string;
  edit?: boolean;
  reset?: boolean;
}

export async function runPersonaCmd(opts: PersonaCmdOptions = {}): Promise<void> {
  const profile = opts.profile ?? process.env.BAJACLAW_PROFILE ?? DEFAULT_PROFILE_NAME;
  const current = loadPersona(profile);

  if (!opts.edit && !opts.reset) {
    if (!current) {
      console.log(chalk.dim(`no persona set for ${profile}. run: bajaclaw persona --edit`));
      return;
    }
    printPersona(profile, current);
    return;
  }

  const existing = opts.reset ? undefined : (current ?? undefined);
  const persona = await edit(existing);
  savePersona(profile, persona);
  console.log("");
  console.log(chalk.green(`✓ saved`));
  console.log(chalk.dim(`  persona:  ${personaPath(profile)}`));
  console.log(chalk.dim(`  identity: ${soulPath(profile)}`));
}

function printPersona(profile: string, p: Persona): void {
  console.log(`profile: ${chalk.bold(profile)}`);
  console.log("");
  console.log(`${chalk.bold("name:     ")} ${chalk.cyan(p.agentName)}`);
  if (p.userName) console.log(`${chalk.bold("talks to: ")} ${p.userName}`);
  if (p.tone) console.log(`${chalk.bold("tone:     ")} ${p.tone}`);
  if (p.timezone) console.log(`${chalk.bold("tz:       ")} ${p.timezone}`);
  if (p.focus) console.log(`${chalk.bold("focus:    ")} ${chalk.dim(p.focus)}`);
  if (p.interests?.length) console.log(`${chalk.bold("interests:")} ${p.interests.join(", ")}`);
  if (p.doNots?.length) console.log(`${chalk.bold("don'ts:   ")} ${p.doNots.join(", ")}`);
  console.log("");
  console.log(chalk.dim("Edit: bajaclaw persona --edit"));
  console.log(chalk.dim("Full identity doc is injected into every cycle. Preview:"));
  console.log("");
  console.log(chalk.dim(renderSoul(p).split("\n").map((l) => "  " + l).join("\n")));
}

async function edit(existing?: Persona): Promise<Persona> {
  const agentName = await ask(chalk.bold("Agent name:"), existing?.agentName ?? "Baja");
  const userName = await ask(chalk.bold("What should it call you?"), existing?.userName ?? "");
  const tone = (await askChoice(chalk.bold("Tone:"), TONE_OPTIONS as string[], existing?.tone ?? "concise")) as Persona["tone"];
  const timezone = await ask(chalk.bold("Timezone (IANA):"), existing?.timezone ?? detectTimezone() ?? "");
  const focus = await ask(chalk.bold("Focus:"), existing?.focus ?? "");
  const interests = await askList(chalk.bold("Interests:"));
  const doNots = await askList(chalk.bold("Don'ts:"));
  return {
    agentName: agentName || "Baja",
    userName: userName || undefined,
    tone,
    timezone: timezone || undefined,
    focus: focus || undefined,
    interests: interests.length > 0 ? interests : existing?.interests,
    doNots: doNots.length > 0 ? doNots : existing?.doNots,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}
