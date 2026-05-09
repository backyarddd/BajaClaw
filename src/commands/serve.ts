import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bajaclawHome } from "../paths.js";
import { serveApi } from "../api/server.js";
import type { ApiConfig } from "../api/server.js";
import { resolveAnthropicKey } from "../api/anthropic-auth.js";
import { isInteractive } from "../prompt.js";

export interface ServeCmdOptions {
  host?: string;
  port?: number;
  apiKey?: string;
  exposedProfiles?: string[];
  streamDelayMs?: number;
}

export async function runServe(opts: ServeCmdOptions = {}): Promise<void> {
  // Resolve merged config: file defaults → CLI overrides.
  const fileCfg = loadUserApiConfig();
  const cfg: ApiConfig = {
    host: opts.host ?? fileCfg.host,
    port: opts.port ?? fileCfg.port,
    apiKey: opts.apiKey ?? fileCfg.apiKey ?? null,
    exposedProfiles: opts.exposedProfiles ?? fileCfg.exposedProfiles,
    streamDelayMs: opts.streamDelayMs ?? fileCfg.streamDelayMs,
  };

  // Refuse to bind a non-localhost host without an API key.
  const host = cfg.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && !cfg.apiKey) {
    console.error(chalk.red(`refusing to bind ${host} without an API key.`));
    console.error(chalk.red(`pass --api-key <secret> or set api.apiKey in ~/.bajaclaw/api.json`));
    process.exit(2);
  }

  // Resolve outbound Anthropic auth before serving. --bare cycles need
  // ANTHROPIC_API_KEY in env; we accept it from env, from api.json, or
  // (on a TTY) we offer to mint one via `claude setup-token`.
  const resolved = await resolveAnthropicKey({ autoSetup: true });
  if (resolved) {
    process.env.ANTHROPIC_API_KEY = resolved.key;
  }

  serveApi({
    ...cfg,
    onReady: ({ host, port }) => {
      console.log(chalk.green(`✓ BajaClaw API listening on http://${host}:${port}/`));
      console.log(chalk.dim(`  OpenAI-compatible:  /v1/chat/completions  /v1/models`));
      console.log(chalk.dim(`  Native:             /v1/bajaclaw/cycle   /v1/bajaclaw/tasks`));
      if (cfg.apiKey) console.log(chalk.dim(`  inbound auth:       Bearer token required`));
      else if (host !== "127.0.0.1" && host !== "localhost") {
        console.log(chalk.yellow(`  WARNING: inbound auth disabled on non-localhost bind`));
      } else {
        console.log(chalk.dim(`  inbound auth:       none (localhost-only)`));
      }
      if (cfg.exposedProfiles?.length) {
        console.log(chalk.dim(`  exposed profiles:   ${cfg.exposedProfiles.join(", ")}`));
      } else {
        console.log(chalk.dim(`  exposed profiles:   all`));
      }
      console.log(chalk.dim(`  cycle mode:         --bare`));
      if (resolved) {
        const sourceLabel =
          resolved.source === "env" ? "env"
          : resolved.source === "saved" ? "saved in ~/.bajaclaw/api.json"
          : "minted via claude setup-token";
        console.log(chalk.dim(`  outbound auth:      ANTHROPIC_API_KEY (${sourceLabel})`));
      } else {
        console.log(chalk.yellow(`  WARNING: no ANTHROPIC_API_KEY resolved. API cycles run with --bare and will`));
        if (isInteractive()) {
          console.log(chalk.yellow(`           401 until a key is set. Run \`bajaclaw setup-token\` to mint one.`));
        } else {
          console.log(chalk.yellow(`           401 until a key is set. Run \`bajaclaw setup-token\` on a TTY to mint one,`));
          console.log(chalk.yellow(`           or export ANTHROPIC_API_KEY in this process's env.`));
        }
      }
    },
  });
  // Keep the process alive.
  await new Promise(() => {});
}

export function userApiConfigPath(): string {
  return join(bajaclawHome(), "api.json");
}

interface ApiFileCfg extends ApiConfig {
  // Outbound Anthropic key for the spawned `claude` subprocess. Read
  // by anthropic-auth.ts; written by `bajaclaw setup-token` and the
  // interactive auto-setup in `bajaclaw serve`. Independent from the
  // inbound `apiKey` bearer token (which authenticates clients
  // connecting TO the bajaclaw HTTP server).
  anthropicApiKey?: string;
}

export function loadUserApiConfig(): ApiFileCfg {
  const p = userApiConfigPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as ApiFileCfg; }
  catch { return {}; }
}
