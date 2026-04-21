// Per-cycle shadow-git snapshots so the user can rewind a cycle.
//
// Architecture: a separate bare git repo at <profileDir>/snapshots/.shadow-git
// tracks the user-supplied root path. We never write inside the user's own
// .git (no risk of conflicting with their actual history). Every cycle that
// opts in commits the work tree before the cycle runs (`pre-cycle-<id>`)
// and again after (`post-cycle-<id>`). Rewinding a cycle checks out the
// pre-cycle commit's contents into the work tree.
//
// Opt-in only: cfg.snapshots = { enabled: true, root?: <path> }. Default
// off. Skipped when git is not on PATH.

import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { profileDir, ensureDir } from "./paths.js";

export interface SnapshotResult {
  ok: boolean;
  sha?: string;
  error?: string;
}

function shadowDir(profile: string): string {
  return join(profileDir(profile), "snapshots", ".shadow-git");
}

async function gitAvailable(): Promise<boolean> {
  try {
    const r = await execa("git", ["--version"], { reject: false, timeout: 3000 });
    return r.exitCode === 0;
  } catch { return false; }
}

async function shadowExec(profile: string, root: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const sd = shadowDir(profile);
  const r = await execa("git", ["--git-dir", sd, "--work-tree", root, ...args], { reject: false });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.exitCode ?? -1 };
}

async function ensureShadow(profile: string, root: string): Promise<boolean> {
  const sd = shadowDir(profile);
  ensureDir(sd);
  if (existsSync(join(sd, "HEAD"))) return true;
  const init = await execa("git", ["init", "--bare", sd], { reject: false });
  if ((init.exitCode ?? 1) !== 0) return false;
  await execa("git", ["--git-dir", sd, "config", "user.email", "shadow@bajaclaw.local"], { reject: false });
  await execa("git", ["--git-dir", sd, "config", "user.name", "BajaClaw Shadow"], { reject: false });
  await shadowExec(profile, root, ["add", "-A"]);
  await shadowExec(profile, root, ["commit", "--allow-empty", "-m", "shadow init"]);
  return true;
}

export async function snapshot(profile: string, root: string, label: string): Promise<SnapshotResult> {
  if (!(await gitAvailable())) return { ok: false, error: "git not on PATH" };
  if (!existsSync(root)) return { ok: false, error: `snapshot root does not exist: ${root}` };
  const ok = await ensureShadow(profile, root);
  if (!ok) return { ok: false, error: "shadow git init failed" };
  await shadowExec(profile, root, ["add", "-A"]);
  const commit = await shadowExec(profile, root, ["commit", "--allow-empty", "-m", label]);
  if (commit.code !== 0) return { ok: false, error: commit.stderr.slice(0, 200) };
  const head = await shadowExec(profile, root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return { ok: false, error: head.stderr.slice(0, 200) };
  return { ok: true, sha: head.stdout.trim() };
}

export async function rewindToSha(profile: string, root: string, sha: string): Promise<SnapshotResult> {
  if (!(await gitAvailable())) return { ok: false, error: "git not on PATH" };
  if (!existsSync(shadowDir(profile))) return { ok: false, error: "no snapshots for this profile" };
  // Hard restore the work tree to the snapshot's contents. Files added
  // after the snapshot get reset; files deleted after are recreated.
  const r = await shadowExec(profile, root, ["checkout", sha, "--", "."]);
  if (r.code !== 0) return { ok: false, error: r.stderr.slice(0, 200) };
  // Stage the result so the next snapshot diff is clean.
  await shadowExec(profile, root, ["add", "-A"]);
  return { ok: true, sha };
}

export async function listSnapshots(profile: string, root: string, limit = 50): Promise<{ sha: string; label: string; date: string }[]> {
  if (!existsSync(shadowDir(profile))) return [];
  const r = await shadowExec(profile, root, ["log", "--all", `-n${limit}`, "--pretty=format:%H%x09%aI%x09%s"]);
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => {
    const [sha, date, ...rest] = l.split("\t");
    return { sha: sha!, date: date!, label: rest.join("\t") };
  });
}
