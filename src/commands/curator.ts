// CLI: bajaclaw curator <run|status|approve|dry-run-only>
import type { Command } from "commander";
import chalk from "chalk";

export function registerCuratorCommands(program: Command): void {
  const cur = program.command("curator").description("Skill library curator");

  cur.command("run [profile]")
    .description("Run curator immediately (default: dry-run)")
    .option("--live", "run in live mode (skip dry-run)")
    .action(async (profile: string = "default", opts: { live?: boolean }) => {
      const { runCurator, CURATOR_DEFAULT } = await import("../skills/curator.js");
      const cfg = { ...CURATOR_DEFAULT, dryRun: !opts.live };
      const r = await runCurator(profile, cfg);
      console.log(JSON.stringify(r, null, 2));
    });

  cur.command("status [profile]")
    .description("Show last run, next run window, recent reports")
    .action(async (profile: string = "default") => {
      const { readCuratorState, CURATOR_DEFAULT } = await import("../skills/curator.js");
      const s = readCuratorState(profile);
      const intervalMs = CURATOR_DEFAULT.intervalHours * 3_600_000;
      let nextEligible: string;
      if (s.last_curator_at) {
        nextEligible = new Date(Date.parse(s.last_curator_at) + intervalMs).toISOString();
      } else if (s.first_run_marker_at) {
        nextEligible = new Date(Date.parse(s.first_run_marker_at) + intervalMs).toISOString();
      } else {
        nextEligible = "(after first idle interval)";
      }
      console.log(JSON.stringify({ ...s, next_eligible: nextEligible }, null, 2));
    });

  cur.command("approve [profile]")
    .description("Switch curator to live mode")
    .action(async (profile: string = "default") => {
      console.log(chalk.yellow(`Set 'curator.dryRun: false' in ~/.bajaclaw/profiles/${profile}/config.json to enable live curator runs.`));
      console.log(chalk.dim(`(One-shot live run available now: \`bajaclaw curator run ${profile} --live\`)`));
    });

  cur.command("dry-run-only [profile]")
    .description("Force curator to stay in dry-run forever")
    .action(async (profile: string = "default") => {
      console.log(chalk.yellow(`Set 'curator.dryRun: true' in ~/.bajaclaw/profiles/${profile}/config.json. (This is the default.)`));
    });
}
