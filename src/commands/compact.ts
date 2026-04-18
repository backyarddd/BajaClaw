// `bajaclaw compact [profile]` - run memory compaction now.
import chalk from "chalk";
import { openDb } from "../db.js";
import { loadConfig, saveConfig } from "../config.js";
import { compact, shouldCompact, mergeCompactionDefaults } from "../memory/compact.js";
import { Logger } from "../logger.js";
import type { CompactionConfig } from "../types.js";

export interface CompactOptions {
  profile: string;
  force?: boolean;
  dryRun?: boolean;
  set?: Partial<CompactionConfig>;
}

export async function runCompact(opts: CompactOptions): Promise<void> {
  const cfg = loadConfig(opts.profile);

  if (opts.set) {
    const next = { ...mergeCompactionDefaults(cfg.compaction), ...opts.set };
    cfg.compaction = next;
    saveConfig(cfg);
    console.log(chalk.green(`✓ saved compaction policy for ${opts.profile}`));
    printPolicy(next);
    return;
  }

  const db = openDb(opts.profile);
  const log = new Logger(opts.profile);

  try {
    if (opts.dryRun) {
      const decision = shouldCompact(db, cfg.compaction);
      const row = db
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS s FROM memories")
        .get() as { n: number; s: number };
      const policy = mergeCompactionDefaults(cfg.compaction);
      console.log(chalk.bold(`compaction (${opts.profile})`));
      printPolicy(policy);
      console.log("");
      console.log(`  memories:       ${row.n.toLocaleString()}`);
      console.log(`  pool size:      ${row.s.toLocaleString()} chars`);
      console.log(`  would run:      ${decision.yes ? chalk.green("yes") : chalk.dim("no")}  ${chalk.dim(decision.reason)}`);
      return;
    }

    if (!opts.force) {
      const decision = shouldCompact(db, cfg.compaction);
      if (!decision.yes) {
        console.log(chalk.dim(`no trigger - ${decision.reason}. Use --force to run anyway.`));
        return;
      }
      console.log(chalk.dim(`trigger: ${decision.reason}`));
    }

    console.log(chalk.cyan("compacting…"));
    const r = await compact(db, cfg.compaction, log);
    console.log(chalk.green(`✓ compacted in ${r.durationMs}ms`));
    console.log(`  memories:       ${r.memoriesBefore.toLocaleString()} → ${r.memoriesAfter.toLocaleString()}`);
    console.log(`  cycles pruned:  ${r.cyclesPruned.toLocaleString()}`);
  } finally {
    db.close();
  }
}

function printPolicy(p: Required<CompactionConfig>): void {
  console.log(chalk.dim("  enabled:        ") + (p.enabled ? "yes" : "no"));
  console.log(chalk.dim("  schedule:       ") + p.schedule);
  console.log(chalk.dim("  threshold:      ") + `${Math.round(p.threshold * 100)}% of 200k-token context window`);
  console.log(chalk.dim("  daily at:       ") + `${p.dailyAtUtc} UTC`);
  console.log(chalk.dim("  keep per kind:  ") + String(p.keepRecentPerKind));
  console.log(chalk.dim("  prune cycles >: ") + `${p.pruneCycleDays} days`);
}
