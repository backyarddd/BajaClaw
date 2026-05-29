// Seamless, fully native onboarding. No OpenClaw. Default path is one step:
// "Sign in with ChatGPT". All other providers live behind "more options".
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { color, glyph, wordmark, panel } from "../ui/theme.mjs";
import { PROVIDERS, load, save } from "../config/config.mjs";
import { installPlist } from "../daemon/daemon.mjs";
import { saveCred } from "../auth/store.mjs";
import { login as chatgptLogin } from "../auth/chatgpt-oauth.mjs";

// Non-interactive: write a sensible default config (used by `--yes`).
export function onboardNonInteractive({ provider = "openai-codex" } = {}) {
  const cfg = load();
  cfg.defaultProvider = provider;
  if (!cfg.providerOrder.includes(provider)) cfg.providerOrder.unshift(provider);
  const path = save(cfg);
  return { provider, configPath: path };
}

async function authenticate(provider, rl) {
  const meta = PROVIDERS.find((p) => p.id === provider);
  if (provider === "openai-codex") {
    try {
      await chatgptLogin({ print: (m) => console.log(color.dim(m)) });
      console.log(`${glyph.ok} Signed in with ChatGPT.`);
      return true;
    } catch (e) {
      console.log(`${glyph.warn} Sign-in did not complete (${e.message}). You can retry later with ${color.bold("bajaclaw onboard")}.`);
      return false;
    }
  }
  if (meta?.kind === "local") {
    console.log(`${glyph.info} ${meta.label} runs locally, no key needed. Make sure it is running.`);
    return true;
  }
  // key-based providers
  const key = (await rl.question(`${glyph.run} Paste your ${meta?.label || provider} API key: `)).trim();
  if (!key) { console.log(`${glyph.warn} No key entered; you can add it later.`); return false; }
  saveCred(provider, { type: "key", api_key: key });
  console.log(`${glyph.ok} Saved ${meta?.label || provider} key.`);
  return true;
}

export async function onboard({ yes = false } = {}) {
  if (yes) {
    const r = onboardNonInteractive();
    console.log(`${glyph.ok} Wrote default config (${r.provider}) -> ${r.configPath}`);
    return r;
  }

  console.log("\n" + wordmark() + "\n");
  console.log(panel("Welcome", [
    color.dim("One question, sensible defaults. About a minute to a running agent."),
    "",
    `${glyph.arrow} Default model: ${color.bold(color.amber("ChatGPT"))} ${color.dim("(sign in with your subscription)")}`,
    color.dim("Every other provider stays available. Type 'more' to choose one."),
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
    console.log(`\n${glyph.ok} Selected ${color.bold(chosen)} -> ${color.dim(cfgPath)}`);

    await authenticate(chosen, rl);

    const wantDaemon = (await rl.question(`\n${glyph.run} Start on every reboot (install gateway daemon)? [Y/n]: `)).trim().toLowerCase();
    if (wantDaemon !== "n") {
      const plist = installPlist();
      console.log(plist ? `${glyph.ok} Daemon installed -> ${color.dim(plist)}` : `${glyph.info} Non-macOS: use 'bajaclaw start' to run the gateway.`);
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
