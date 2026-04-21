#!/usr/bin/env node
// Compile helpers/imessage-typing.m into a universal macOS binary.
//
// Invoked at build time (npm run build) on macOS, and also manually via
// `node scripts/build-imessage-helper.mjs` for contributors. On non-mac
// platforms it's a no-op (logs and exits 0). The resulting binary lives
// at helpers/bajaclaw-imessage-helper (checked into git + shipped in the
// npm tarball so users don't need Xcode CLI Tools).
//
// Universal binary: we build arm64 + x86_64 and `lipo` them together so
// the same helper runs on every modern Mac. If either arch fails (e.g.
// Rosetta/cross-SDK not available), falls back to the host-native arch.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "helpers", "imessage-typing.m");
const out = join(root, "helpers", "bajaclaw-imessage-helper");

if (process.platform !== "darwin") {
  console.log("[build-imessage-helper] skipping: not macOS");
  process.exit(0);
}

if (!existsSync(src)) {
  console.error(`[build-imessage-helper] source missing: ${src}`);
  process.exit(1);
}

// Need clang. `xcrun` finds it whether Xcode.app or Command Line Tools
// are installed. If neither, bail cleanly - the adapter falls back to
// no-op typing.
const xcrun = spawnSync("xcrun", ["--find", "clang"], { encoding: "utf8" });
if (xcrun.status !== 0) {
  console.log("[build-imessage-helper] skipping: xcrun/clang not available (install Xcode Command Line Tools for native typing)");
  process.exit(0);
}
const clang = xcrun.stdout.trim();

// Clang on macOS needs `-isysroot` pointing at the SDK or it can't find
// Foundation.h. `xcrun --show-sdk-path` gives us the right one whether
// the full Xcode.app or just CommandLineTools is installed.
const sdkProbe = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
if (sdkProbe.status !== 0) {
  console.log("[build-imessage-helper] skipping: macOS SDK not found");
  process.exit(0);
}
const sdkPath = sdkProbe.stdout.trim();

function compile(arch, outPath) {
  const args = [
    "-isysroot", sdkPath,
    "-arch", arch,
    "-framework", "Foundation",
    "-ObjC",
    "-fobjc-arc",
    "-O2",
    "-o", outPath,
    src,
  ];
  const r = spawnSync(clang, args, { stdio: "inherit" });
  return r.status === 0;
}

mkdirSync(dirname(out), { recursive: true });

const tmpArm = out + ".arm64";
const tmpX86 = out + ".x86_64";

const armOk = compile("arm64", tmpArm);
const x86Ok = compile("x86_64", tmpX86);

if (armOk && x86Ok) {
  // lipo into universal
  const lipo = spawnSync("lipo", ["-create", tmpArm, tmpX86, "-output", out], { stdio: "inherit" });
  try { unlinkSync(tmpArm); } catch { /* ignore */ }
  try { unlinkSync(tmpX86); } catch { /* ignore */ }
  if (lipo.status !== 0) {
    console.error("[build-imessage-helper] lipo failed");
    process.exit(1);
  }
  console.log(`[build-imessage-helper] built universal binary: ${out}`);
} else if (armOk) {
  renameSync(tmpArm, out);
  try { unlinkSync(tmpX86); } catch { /* ignore */ }
  console.log(`[build-imessage-helper] built arm64 only: ${out}`);
} else if (x86Ok) {
  renameSync(tmpX86, out);
  try { unlinkSync(tmpArm); } catch { /* ignore */ }
  console.log(`[build-imessage-helper] built x86_64 only: ${out}`);
} else {
  console.error("[build-imessage-helper] both architectures failed to compile");
  process.exit(1);
}

// Sanity: make sure it's executable and strip quarantine if present.
spawnSync("chmod", ["+x", out]);
spawnSync("xattr", ["-dr", "com.apple.quarantine", out]);

process.exit(0);
