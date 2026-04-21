// Fluid tool bootstrap. One entry point every skill (and every internal
// path that needs a system tool) calls. Handles: detect platform, detect
// available package managers, install the tool via whichever manager is
// present, verify the install, then (optionally) kick off the tool's
// auth flow so the caller doesn't have to.
//
// Design goals:
// - Cross-platform (darwin/linux/win32) with graceful degradation.
// - No sudo surprises: prefer user-land installers (brew, scoop, npm,
//   pipx) when a tool offers them, only fall back to system package
//   managers (apt/dnf/pacman) when nothing else fits.
// - Idempotent: calling `ensureTool` when already installed + authed
//   returns ok:true with no side effects.
// - Structured exit codes on the CLI side (see commands/ensure.ts).
import { spawnSync } from "node:child_process";
import { RECIPES } from "./ensure-recipes.js";

export type OsKind = "darwin" | "linux" | "win32";

export type PackageManager =
  | "brew"
  | "apt"
  | "dnf"
  | "pacman"
  | "winget"
  | "scoop"
  | "choco"
  | "npm"
  | "pipx"
  | "pip"
  | "cargo";

export interface PlatformInfo {
  os: OsKind;
  managers: PackageManager[];
}

export interface InstallStep {
  // Preferred manager for this step. The runner picks the first entry
  // whose `manager` is in PlatformInfo.managers.
  manager: PackageManager;
  // Exact argv for the installer. NOT shell-interpreted.
  argv: string[];
  // Optional pre-step: often used to add a 3rd-party repo (apt keyring
  // for gh, scoop bucket for supabase, etc). argv form.
  pre?: string[][];
  // Human label rendered while running.
  label?: string;
  // Skip if this bin is already on PATH. Lets a step declare its own
  // success check (e.g. a sidecar bin added separately).
  skipIfBin?: string;
}

export interface Recipe {
  // Canonical tool name, matches the argv of `bajaclaw ensure <name>`.
  name: string;
  // Short human description for logs.
  describe: string;
  // Binary(ies) on PATH that signal "installed".
  bins: string[];
  // Ordered install plan. Runner iterates in order; first matching
  // manager (present on the box) wins. Each step is self-contained
  // (can include its own pre-step).
  steps: Partial<Record<OsKind, InstallStep[]>>;
  // Optional: command + args that returns exit 0 when authed.
  // If omitted, the tool has no auth state to check.
  authCheck?: { argv: string[]; successPattern?: RegExp };
  // Optional: interactive login command. Runner inherits stdio so
  // the user can complete OAuth/device flows directly.
  authLogin?: { argv: string[]; notes?: string };
  // Optional: documentation URL printed when install fails.
  docs?: string;
}

export type EnsureOutcome =
  | { status: "ready"; detail: string }
  | { status: "install-failed"; detail: string; recipe: Recipe }
  | { status: "auth-pending"; detail: string; recipe: Recipe }
  | { status: "unsupported"; detail: string; recipe?: Recipe }
  | { status: "no-manager"; detail: string; recipe: Recipe };

// Cache platform detection - invariant for the lifetime of a process.
let cachedPlatform: PlatformInfo | null = null;

export function detectPlatform(): PlatformInfo {
  if (cachedPlatform) return cachedPlatform;
  const os: OsKind = process.platform === "darwin" ? "darwin"
    : process.platform === "win32" ? "win32"
    : "linux";
  const managers: PackageManager[] = [];
  for (const m of ALL_MANAGERS) {
    if (hasBin(managerBin(m))) managers.push(m);
  }
  cachedPlatform = { os, managers };
  return cachedPlatform;
}

const ALL_MANAGERS: PackageManager[] = [
  "brew", "winget", "scoop", "choco", "apt", "dnf", "pacman",
  "npm", "pipx", "pip", "cargo",
];

function managerBin(m: PackageManager): string {
  switch (m) {
    case "brew": return "brew";
    case "apt": return "apt-get";
    case "dnf": return "dnf";
    case "pacman": return "pacman";
    case "winget": return "winget";
    case "scoop": return "scoop";
    case "choco": return "choco";
    case "npm": return "npm";
    case "pipx": return "pipx";
    case "pip": return "pip3";
    case "cargo": return "cargo";
  }
}

export function hasBin(bin: string): boolean {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  const r = spawnSync(probe, [bin], { stdio: "ignore" });
  return r.status === 0;
}

export function findRecipe(name: string): Recipe | undefined {
  return RECIPES.find((r) => r.name === name);
}

export function listRecipes(): Recipe[] {
  return [...RECIPES];
}

export interface EnsureOptions {
  // Run the tool's auth flow after install if a recipe defines one.
  auth?: boolean;
  // Suppress human progress output. Exit codes still meaningful.
  quiet?: boolean;
  // Stream manager output directly to the user (default). If false,
  // capture and echo only on failure.
  inherit?: boolean;
  // Advisory: don't actually install; just check. Used by callers
  // who want to branch on already-installed without side effects.
  checkOnly?: boolean;
}

export async function ensureTool(name: string, opts: EnsureOptions = {}): Promise<EnsureOutcome> {
  const recipe = findRecipe(name);
  if (!recipe) {
    return { status: "unsupported", detail: `no recipe for "${name}". Known: ${RECIPES.map((r) => r.name).join(", ")}` };
  }

  const plat = detectPlatform();
  const alreadyInstalled = recipe.bins.every((b) => hasBin(b));

  // Install path.
  if (!alreadyInstalled) {
    if (opts.checkOnly) {
      return { status: "install-failed", detail: `${recipe.name} not installed (check-only)`, recipe };
    }
    const installed = await runInstall(recipe, plat, opts);
    if (!installed.ok) return installed.outcome;
  } else if (!opts.quiet) {
    log(`  ${recipe.name}: already installed`);
  }

  // Auth path (only if caller asked for it).
  if (opts.auth && recipe.authCheck) {
    const authed = await checkAuth(recipe);
    if (authed) {
      if (!opts.quiet) log(`  ${recipe.name}: authenticated`);
      return { status: "ready", detail: `${recipe.name} installed + authenticated` };
    }
    if (recipe.authLogin) {
      if (!opts.quiet) {
        log(`  ${recipe.name}: not authenticated. Launching login flow...`);
        if (recipe.authLogin.notes) log(`  (${recipe.authLogin.notes})`);
      }
      const launched = spawnSync(recipe.authLogin.argv[0]!, recipe.authLogin.argv.slice(1), { stdio: "inherit" });
      if (launched.status === 0) {
        // Re-check after the interactive login returns.
        const after = await checkAuth(recipe);
        if (after) return { status: "ready", detail: `${recipe.name} installed + authenticated` };
      }
      return { status: "auth-pending", detail: `${recipe.name} installed; finish authentication with: ${recipe.authLogin.argv.join(" ")}`, recipe };
    }
    return { status: "auth-pending", detail: `${recipe.name} installed but not authenticated`, recipe };
  }

  return { status: "ready", detail: `${recipe.name} installed` };
}

async function runInstall(
  recipe: Recipe,
  plat: PlatformInfo,
  opts: EnsureOptions,
): Promise<{ ok: true } | { ok: false; outcome: EnsureOutcome }> {
  const steps = recipe.steps[plat.os];
  if (!steps || steps.length === 0) {
    return {
      ok: false,
      outcome: {
        status: "unsupported",
        detail: `no install recipe for ${recipe.name} on ${plat.os}. Install manually${recipe.docs ? `: ${recipe.docs}` : ""}.`,
        recipe,
      },
    };
  }

  const candidates = steps.filter((s) => plat.managers.includes(s.manager));
  if (candidates.length === 0) {
    return {
      ok: false,
      outcome: {
        status: "no-manager",
        detail: `${recipe.name} needs one of: ${steps.map((s) => s.manager).join(", ")}. None found. ${recipe.docs ?? ""}`.trim(),
        recipe,
      },
    };
  }

  for (const step of candidates) {
    if (step.skipIfBin && hasBin(step.skipIfBin)) continue;
    if (!opts.quiet) log(`  ${recipe.name}: installing via ${step.manager}${step.label ? ` (${step.label})` : ""}...`);
    if (step.pre) {
      for (const pre of step.pre) {
        const rp = spawnSync(pre[0]!, pre.slice(1), { stdio: opts.inherit === false ? "pipe" : "inherit" });
        if (rp.status !== 0) {
          if (!opts.quiet) log(`  ${recipe.name}: pre-step failed (${pre.join(" ")}), trying next option`);
          // Pre-step failure aborts this candidate but lets us try the next one.
          return continueOrFail(recipe, candidates, step);
        }
      }
    }
    const r = spawnSync(step.argv[0]!, step.argv.slice(1), { stdio: opts.inherit === false ? "pipe" : "inherit" });
    if (r.status === 0 && recipe.bins.every((b) => hasBin(b))) {
      if (!opts.quiet) log(`  ${recipe.name}: install succeeded`);
      return { ok: true };
    }
    if (!opts.quiet) log(`  ${recipe.name}: install via ${step.manager} did not produce the expected binary, trying next option`);
  }

  return {
    ok: false,
    outcome: {
      status: "install-failed",
      detail: `all install attempts for ${recipe.name} failed. ${recipe.docs ?? ""}`.trim(),
      recipe,
    },
  };
}

function continueOrFail(
  recipe: Recipe,
  candidates: InstallStep[],
  failed: InstallStep,
): { ok: true } | { ok: false; outcome: EnsureOutcome } {
  const idx = candidates.indexOf(failed);
  const remaining = candidates.slice(idx + 1);
  if (remaining.length === 0) {
    return {
      ok: false,
      outcome: {
        status: "install-failed",
        detail: `all install attempts for ${recipe.name} failed. ${recipe.docs ?? ""}`.trim(),
        recipe,
      },
    };
  }
  // Caller loop will pick up the next candidate.
  return { ok: false, outcome: { status: "install-failed", detail: "intermediate", recipe } };
}

async function checkAuth(recipe: Recipe): Promise<boolean> {
  if (!recipe.authCheck) return true;
  const r = spawnSync(recipe.authCheck.argv[0]!, recipe.authCheck.argv.slice(1), { encoding: "utf8" });
  if (r.status !== 0) return false;
  if (recipe.authCheck.successPattern) {
    return recipe.authCheck.successPattern.test((r.stdout || "") + (r.stderr || ""));
  }
  return true;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

// Exit codes used by the CLI layer. Kept here so skill docs and the
// CLI command share one source of truth.
export const EXIT_READY = 0;
export const EXIT_INSTALL_FAILED = 10;
export const EXIT_AUTH_PENDING = 20;
export const EXIT_UNSUPPORTED = 30;
export const EXIT_NO_MANAGER = 40;

export function exitCodeFor(outcome: EnsureOutcome): number {
  switch (outcome.status) {
    case "ready": return EXIT_READY;
    case "install-failed": return EXIT_INSTALL_FAILED;
    case "auth-pending": return EXIT_AUTH_PENDING;
    case "unsupported": return EXIT_UNSUPPORTED;
    case "no-manager": return EXIT_NO_MANAGER;
  }
}
