// `bajaclaw rewind <cycleId>` - restore the work tree to its
// pre-cycle state using the shadow-git snapshot recorded by the
// snapshots.ts pre-snapshot hook. Destructive: overwrites uncommitted
// edits in the snapshot root. Always requires --yes unless invoked
// with --dry-run.

import chalk from "chalk";
import { openDb } from "../db.js";
import { rewindToSha, listSnapshots } from "../snapshots.js";

export interface RewindOpts {
  profile: string;
  cycleId: number;
  yes?: boolean;
  dryRun?: boolean;
}

export async function cmdRewind(opts: RewindOpts): Promise<void> {
  const db = openDb(opts.profile);
  let pre: string | null = null;
  let root: string | null = null;
  try {
    const row = db.prepare("SELECT pre_sha, snapshot_root FROM cycles WHERE id = ?").get(opts.cycleId) as { pre_sha: string | null; snapshot_root: string | null } | undefined;
    if (!row) {
      console.error(chalk.red(`rewind: cycle #${opts.cycleId} not found`));
      process.exit(1);
    }
    pre = row.pre_sha;
    root = row.snapshot_root;
  } finally { db.close(); }

  if (!pre || !root) {
    console.error(chalk.red(`rewind: cycle #${opts.cycleId} was not snapshotted (snapshots.enabled=false at run time)`));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(chalk.dim(`would rewind ${root} to ${pre.slice(0, 12)} (cycle #${opts.cycleId} pre-snapshot)`));
    return;
  }

  if (!opts.yes) {
    console.log(chalk.yellow("destructive: this will overwrite uncommitted changes in the snapshot root."));
    console.log(chalk.dim(`  root:  ${root}`));
    console.log(chalk.dim(`  cycle: #${opts.cycleId}`));
    console.log(chalk.dim(`  sha:   ${pre.slice(0, 12)}`));
    console.log("");
    console.log(chalk.dim("re-run with --yes to proceed."));
    process.exit(2);
  }

  const r = await rewindToSha(opts.profile, root, pre);
  if (!r.ok) {
    console.error(chalk.red(`rewind: ${r.error}`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ rewound ${root} to cycle #${opts.cycleId} pre-snapshot (${pre.slice(0, 12)})`));
}

export async function cmdSnapshotList(profile: string, root?: string): Promise<void> {
  const r = root ?? process.cwd();
  const list = await listSnapshots(profile, r);
  if (list.length === 0) {
    console.log(chalk.dim("no snapshots"));
    return;
  }
  for (const s of list) {
    console.log(`${chalk.dim(s.sha.slice(0, 12))}  ${chalk.dim(s.date.slice(0, 19))}  ${s.label}`);
  }
}
