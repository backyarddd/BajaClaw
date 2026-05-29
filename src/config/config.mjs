// BajaClaw config layer. Stores under ~/.bajaclaw (fresh in v2).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

export const HOME = homedir();
export const CONFIG_DIR = process.env.BAJACLAW_HOME || join(HOME, ".bajaclaw");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// All providers OpenClaw supports stay selectable. ChatGPT-OAuth is the default.
// `kind` drives how onboarding authenticates each one.
export const PROVIDERS = [
  { id: "openai-codex", label: "ChatGPT (sign in with your subscription)", kind: "oauth", recommended: true },
  { id: "anthropic", label: "Anthropic / Claude (API key or Claude CLI login)", kind: "key-or-cli" },
  { id: "google", label: "Google Gemini (API key)", kind: "key" },
  { id: "openrouter", label: "OpenRouter (one key, 200+ models)", kind: "key" },
  { id: "openai", label: "OpenAI API key (metered)", kind: "key" },
  { id: "ollama", label: "Ollama (local models, no key)", kind: "local" },
  { id: "lmstudio", label: "LM Studio (local OpenAI-compatible)", kind: "local" },
  { id: "groq", label: "Groq (API key)", kind: "key" },
  { id: "deepseek", label: "DeepSeek (API key)", kind: "key" },
];

export const DEFAULTS = {
  version: 1,
  // ChatGPT-OAuth default; precedence is the fallback order if a provider is rate-limited.
  defaultProvider: "openai-codex",
  // Fallback order among providers you have set up. Local providers (ollama,
  // lmstudio) are opt-in via onboarding so a fresh install reports honestly.
  providerOrder: ["openai-codex", "anthropic", "openrouter", "google"],
  gateway: {
    host: "127.0.0.1",
    port: 18789, // OpenClaw gateway default; the daemon is the gateway.
  },
  ui: {
    host: "127.0.0.1",
    port: 18790, // BajaClaw web UI (served from web/dist by the daemon).
  },
  openaiEndpoint: {
    enabled: true,
    host: "127.0.0.1", // localhost-only by default: keeps ChatGPT-OAuth use ToS-safe.
    port: 11435, // local-LLM endpoint (11434 is Ollama's port, kept free for that provider).
    apiKey: "", // optional shared secret for local clients; empty = no auth.
  },
  channels: {
    // Native channels. Enable + add a token, then `bajaclaw restart`.
    telegram: { enabled: false, token: "" },
    discord: { enabled: false, token: "" },
    slack: { enabled: false, token: "" },
    whatsapp: { enabled: false, token: "" },
    imessage: { enabled: false },
  },
  selfUpdate: {
    enabled: true,
    intervalHours: 24,
    mode: "propose", // propose | sandbox | notify
    watch: {
      openclaw: "openclaw/openclaw",
      hermes: "NousResearch/hermes-agent",
      coworkChangelog: "https://www.anthropic.com/product/claude-cowork",
    },
  },
  features: {
    hermesBrain: true,
    coworkMode: true,
  },
};

export function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function load() {
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return deepMerge(structuredClone(DEFAULTS), raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(cfg) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return CONFIG_PATH;
}

export function isOnboarded() {
  return existsSync(CONFIG_PATH);
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) {
      base[k] = deepMerge(base[k] || {}, over[k]);
    } else {
      base[k] = over[k];
    }
  }
  return base;
}
