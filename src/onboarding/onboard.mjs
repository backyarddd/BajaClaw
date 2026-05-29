// Extensive, seamless onboarding. Walks through: primary model, fallback
// providers, the local API, channels, features, and the boot daemon. Every step
// has a sensible default you can accept with Enter, so it stays fast.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { color, glyph, wordmark, panel } from "../ui/theme.mjs";
import { PROVIDERS, load, save } from "../config/config.mjs";
import { installPlist } from "../daemon/daemon.mjs";
import { saveCred } from "../auth/store.mjs";
import { login as chatgptLogin } from "../auth/chatgpt-oauth.mjs";

// Non-interactive default config (used by `--yes` and first `start`).
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
    try { await chatgptLogin({ print: (m) => console.log(color.dim(m)) }); console.log(`${glyph.ok} Signed in with ChatGPT.`); return true; }
    catch (e) { console.log(`${glyph.warn} Sign-in did not complete (${e.message}). Retry later: ${color.bold("bajaclaw login openai-codex")}`); return false; }
  }
  if (meta?.kind === "local") { console.log(`${glyph.info} ${meta.label} runs locally, no key needed. Make sure it is running.`); return true; }
  const key = (await rl.question(`${glyph.run} Paste your ${meta?.label || provider} API key (Enter to skip): `)).trim();
  if (!key) { console.log(`${glyph.warn} Skipped; add it later with ${color.bold(`bajaclaw login ${provider}`)}.`); return false; }
  saveCred(provider, { type: "key", api_key: key });
  console.log(`${glyph.ok} Saved ${meta?.label || provider} key.`);
  return true;
}

const ask = async (rl, q, def = "") => ((await rl.question(q)).trim() || def);
const yn = async (rl, q, defYes = true) => {
  const a = (await rl.question(`${q} ${defYes ? "[Y/n]" : "[y/N]"}: `)).trim().toLowerCase();
  if (!a) return defYes;
  return a === "y" || a === "yes";
};

export async function onboard({ yes = false } = {}) {
  if (yes) {
    const r = onboardNonInteractive();
    console.log(`${glyph.ok} Wrote default config (${r.provider}) -> ${r.configPath}`);
    return r;
  }

  console.log("\n" + wordmark() + "\n");
  console.log(panel("Welcome to BajaClaw", [
    color.dim("A quick guided setup. Press Enter to accept the default at any step."),
  ]) + "\n");

  const rl = createInterface({ input: stdin, output: stdout });
  const cfg = load();
  try {
    // Step 1: primary model
    console.log(color.bold(color.sand("1. Primary model")));
    console.log(`   ${glyph.arrow} Default: ${color.bold(color.amber("ChatGPT"))} ${color.dim("(sign in with your subscription)")}`);
    const more = (await ask(rl, `   Press ${color.bold("Enter")} for ChatGPT, or type ${color.bold("more")} to choose another: `)).toLowerCase();
    let primary = "openai-codex";
    if (more === "more" || more === "m") {
      console.log("");
      PROVIDERS.forEach((p, i) => console.log(`     ${color.amber(String(i + 1).padStart(2))}. ${p.label}${p.recommended ? color.teal(" (recommended)") : ""}`));
      const pick = await ask(rl, `\n   Choose a number [1]: `, "1");
      primary = PROVIDERS[parseInt(pick, 10) - 1]?.id || "openai-codex";
    }
    cfg.defaultProvider = primary;
    cfg.providerOrder = [primary, ...cfg.providerOrder.filter((p) => p !== primary)];
    await authenticate(primary, rl);

    // Step 2: fallback providers
    console.log("\n" + color.bold(color.sand("2. Fallback providers")) + color.dim("  (optional; used if the primary is rate-limited)"));
    if (await yn(rl, `   Add a fallback provider?`, false)) {
      let adding = true;
      while (adding) {
        const others = PROVIDERS.filter((p) => p.id !== primary);
        others.forEach((p, i) => console.log(`     ${color.amber(String(i + 1).padStart(2))}. ${p.label}`));
        const pick = await ask(rl, `   Number to add (Enter to stop): `);
        if (!pick) break;
        const prov = others[parseInt(pick, 10) - 1];
        if (prov) {
          await authenticate(prov.id, rl);
          if (!cfg.providerOrder.includes(prov.id)) cfg.providerOrder.push(prov.id);
        }
        adding = await yn(rl, `   Add another?`, false);
      }
    }

    // Step 3: local API
    console.log("\n" + color.bold(color.sand("3. Local OpenAI endpoint")) + color.dim("  (use BajaClaw as a local LLM)"));
    cfg.openaiEndpoint.enabled = await yn(rl, `   Enable the local API on port ${cfg.openaiEndpoint.port}?`, true);
    if (cfg.openaiEndpoint.enabled) {
      const bare = await yn(rl, `   Default to bare mode (no memory/system prompt/tools)?`, false);
      cfg.openaiEndpoint.mode = bare ? "raw" : "agent";
    }

    // Step 4: channels
    console.log("\n" + color.bold(color.sand("4. Channels")) + color.dim("  (chat with BajaClaw from a messaging app)"));
    for (const id of ["telegram", "discord"]) {
      if (await yn(rl, `   Set up ${id}?`, false)) {
        const token = (await ask(rl, `     Paste the ${id} bot token: `));
        if (token) { cfg.channels[id] = { enabled: true, token }; console.log(`   ${glyph.ok} ${id} configured.`); }
        else console.log(`   ${glyph.warn} No token; skipped.`);
      }
    }
    console.log(color.dim(`   (Slack, WhatsApp, iMessage can be added later in the web UI or config.)`));

    // Step 5: features
    console.log("\n" + color.bold(color.sand("5. Features")));
    cfg.features.hermesBrain = await yn(rl, `   Self-improving memory + skills (Hermes brain)?`, true);
    cfg.features.coworkMode = await yn(rl, `   Cowork outcome mode (goal in, deliverable out)?`, true);
    const su = await yn(rl, `   Daily self-update check (proposes upstream features)?`, true);
    cfg.selfUpdate.enabled = su;

    // Save everything
    const cfgPath = save(cfg);
    console.log(`\n${glyph.ok} Configuration saved -> ${color.dim(cfgPath)}`);

    // Step 6: boot daemon
    console.log("\n" + color.bold(color.sand("6. Run at startup")));
    if (await yn(rl, `   Install the gateway daemon so it starts on boot?`, true)) {
      const plist = installPlist();
      console.log(plist ? `   ${glyph.ok} Daemon installed -> ${color.dim(plist)}` : `   ${glyph.info} Non-macOS: use 'bajaclaw start'.`);
    }

    console.log("\n" + panel("You're set", [
      `${glyph.arrow} ${color.bold("bajaclaw start")}   start everything (run this after a reboot)`,
      `${glyph.arrow} ${color.bold("bajaclaw ui")}      open the web interface`,
      `${glyph.arrow} ${color.bold("bajaclaw ask")} \"…\"  ask a question from the terminal`,
      `${glyph.arrow} ${color.bold("bajaclaw status")}  check health`,
    ]) + "\n");
    return { provider: primary, configPath: cfgPath };
  } finally {
    rl.close();
  }
}
