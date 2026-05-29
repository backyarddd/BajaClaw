// Seamless onboarding. Default path = "Sign in with ChatGPT" (one step).
// All other providers live behind "more options". The actual provider auth is
// delegated to OpenClaw (which owns the OAuth/keys); we keep the UX dead-simple.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execFileSync } from "node:child_process";
import { color, glyph, wordmark, panel } from "../ui/theme.mjs";
import { PROVIDERS, load, save } from "../config/config.mjs";
import { installPlist } from "../daemon/daemon.mjs";

function hasOpenclaw() {
  try {
    execFileSync("openclaw", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    try { execFileSync("npx", ["--no-install", "openclaw", "--version"], { stdio: "ignore" }); return true; }
    catch { return false; }
  }
}

function delegateAuth(providerId) {
  // OpenClaw owns auth. Run its login for the chosen provider.
  const cmds = [
    ["openclaw", ["models", "auth", "login", "--provider", providerId]],
    ["npx", ["openclaw", "models", "auth", "login", "--provider", providerId]],
  ];
  for (const [cmd, args] of cmds) {
    try { execFileSync(cmd, args, { stdio: "inherit" }); return true; } catch {}
  }
  return false;
}

// Non-interactive: write a sensible default config (used by smoketest / --yes).
export function onboardNonInteractive({ provider = "openai-codex" } = {}) {
  const cfg = load();
  cfg.defaultProvider = provider;
  if (!cfg.providerOrder.includes(provider)) cfg.providerOrder.unshift(provider);
  const path = save(cfg);
  return { provider, configPath: path };
}

export async function onboard({ yes = false } = {}) {
  if (yes) {
    const r = onboardNonInteractive();
    console.log(`${glyph.ok} Wrote default config (${r.provider}) → ${r.configPath}`);
    return r;
  }

  console.log("\n" + wordmark() + "\n");
  console.log(panel("Welcome", [
    color.dim("One question, sensible defaults. ~1 minute to a running agent."),
    "",
    `${glyph.arrow} Default model: ${color.bold(color.amber("ChatGPT"))} ${color.dim("(sign in with your subscription)")}`,
    color.dim("All other providers stay available - type 'more' to see them."),
  ]) + "\n");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ans = (await rl.question(
      `${glyph.run} Press ${color.bold("Enter")} to use ChatGPT, or type ${color.bold("more")} for other LLMs: `
    )).trim().toLowerCase();

    let chosen = "openai-codex";
    if (ans === "more" || ans === "m") {
      console.log("");
      PROVIDERS.forEach((p, i) => {
        const tag = p.recommended ? color.teal(" (recommended)") : "";
        console.log(`  ${color.amber(String(i + 1).padStart(2))}. ${p.label}${tag}`);
      });
      const pick = (await rl.question(`\n${glyph.run} Choose a number [1]: `)).trim();
      const idx = pick ? parseInt(pick, 10) - 1 : 0;
      chosen = PROVIDERS[idx]?.id || "openai-codex";
    }

    const cfg = load();
    cfg.defaultProvider = chosen;
    cfg.providerOrder = [chosen, ...cfg.providerOrder.filter((p) => p !== chosen)];
    const cfgPath = save(cfg);
    console.log(`\n${glyph.ok} Selected ${color.bold(chosen)} → ${color.dim(cfgPath)}`);

    // Delegate the actual login to OpenClaw.
    if (hasOpenclaw()) {
      console.log(`${glyph.info} Opening the ${chosen} sign-in…`);
      const ok = delegateAuth(chosen);
      console.log(ok ? `${glyph.ok} Signed in.` : `${glyph.warn} Finish sign-in later: ${color.dim(`openclaw models auth login --provider ${chosen}`)}`);
    } else {
      console.log(`${glyph.warn} OpenClaw core not installed yet. Run ${color.bold("bajaclaw start")} once - it will install the gateway, then re-run ${color.bold("bajaclaw onboard")} to sign in.`);
    }

    const wantDaemon = (await rl.question(`\n${glyph.run} Start on every reboot (install gateway daemon)? [Y/n]: `)).trim().toLowerCase();
    if (wantDaemon !== "n") {
      const plist = installPlist();
      console.log(plist ? `${glyph.ok} Daemon installed → ${color.dim(plist)}` : `${glyph.info} Non-macOS: use 'bajaclaw start' to run the gateway.`);
    }

    console.log("\n" + panel("You're set", [
      `${glyph.arrow} ${color.bold("bajaclaw start")}   start everything (run this after a reboot)`,
      `${glyph.arrow} ${color.bold("bajaclaw ui")}      open the web interface`,
      `${glyph.arrow} ${color.bold("bajaclaw status")}  check health`,
    ]) + "\n");
    return { provider: chosen, configPath: cfgPath };
  } finally {
    rl.close();
  }
}
