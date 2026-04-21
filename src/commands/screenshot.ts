// Cross-platform screenshot capture. Returns the output path.
//
// macOS: uses `screencapture`. Built in to every macOS install.
// Linux: tries `grim` (wayland), `scrot`, `maim`, `import` (imagemagick)
//        in that order. First one that exits 0 wins.
// Windows: inline PowerShell that uses System.Windows.Forms.Screen +
//          System.Drawing.Bitmap. No external binary needed.
//
// Used both by the `bajaclaw screenshot` CLI and by the chat composer's
// `@screen` ref handler (see src/at-refs.ts).

import { spawnSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";

export interface ScreenshotOpts {
  profile?: string;
  output?: string;
  interactive?: boolean;  // macOS -i: click a window or drag a region
  display?: number;       // macOS -D: 1-indexed display
  region?: string;        // "x,y,w,h" - macOS -R
  quiet?: boolean;
}

export async function takeScreenshot(opts: ScreenshotOpts = {}): Promise<string> {
  const out = opts.output ?? defaultPath(opts.profile);
  ensureDir(dirname(out));
  const os = platform();
  if (os === "darwin") captureDarwin(out, opts);
  else if (os === "linux") captureLinux(out);
  else if (os === "win32") captureWin32(out);
  else throw new Error(`screenshot: unsupported platform '${os}'`);
  if (!existsSync(out)) {
    throw new Error(`screenshot: capture reported success but no file at ${out}`);
  }
  return out;
}

export function defaultPath(profile?: string): string {
  const dir = profile ? join(profileDir(profile), "screenshots") : join(tmpdir(), "bajaclaw-screenshots");
  ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return join(dir, `${ts}.png`);
}

function captureDarwin(out: string, opts: ScreenshotOpts): void {
  const argv: string[] = ["-x"]; // -x: silent (no camera-click sound)
  if (opts.interactive) argv.push("-i");
  if (opts.display != null) argv.push("-D", String(opts.display));
  if (opts.region) argv.push("-R", opts.region);
  argv.push(out);
  const r = spawnSync("screencapture", argv, {
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (r.error) {
    throw new Error(`screenshot: screencapture failed: ${(r.error as Error).message}`);
  }
  if (r.status !== 0) {
    // Most common cause on macOS 11+: Screen Recording permission not
    // granted to the parent terminal. The binary exits 1 with no
    // stderr; the only tell is that the PNG is absent. Point the user
    // at the System Settings pane.
    throw new Error(
      `screenshot: screencapture exited ${r.status}. ` +
      "If the file wasn't created, macOS Screen Recording permission is likely not granted " +
      "to this terminal. Grant it in System Settings > Privacy & Security > Screen Recording, " +
      "then restart the terminal.",
    );
  }
}

function captureLinux(out: string): void {
  const candidates: { cmd: string; args: string[] }[] = [
    { cmd: "grim", args: [out] },
    { cmd: "scrot", args: ["-o", out] },
    { cmd: "maim", args: [out] },
    { cmd: "import", args: ["-window", "root", out] },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, { stdio: "pipe" });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (r.status === 0) return;
  }
  throw new Error(
    "screenshot: no capture tool found. Install one of: grim (wayland), scrot, maim, or imagemagick.",
  );
}

function captureWin32(out: string): void {
  // PowerShell one-liner. Escapes the single quote for the inline path.
  const escaped = out.replace(/'/g, "''");
  const ps =
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
    "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; " +
    "$bm = New-Object System.Drawing.Bitmap $b.Width,$b.Height; " +
    "$g = [System.Drawing.Graphics]::FromImage($bm); " +
    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); " +
    `$bm.Save('${escaped}'); ` +
    "$g.Dispose(); $bm.Dispose()";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "pipe" });
  if (r.error) throw new Error(`screenshot: powershell failed: ${(r.error as Error).message}`);
  if (r.status !== 0) {
    const stderr = (r.stderr ?? "").toString().slice(0, 500);
    throw new Error(`screenshot: powershell exited ${r.status}: ${stderr}`);
  }
}

export async function runScreenshotCommand(opts: ScreenshotOpts): Promise<void> {
  try {
    const path = await takeScreenshot(opts);
    if (!opts.quiet) console.log(chalk.green("✓ ") + path);
    else console.log(path);
  } catch (e) {
    console.error(chalk.red((e as Error).message));
    process.exit(1);
  }
}
