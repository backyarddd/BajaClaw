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

  // Resolve outbound Anthropic auth before serving. Lightweight cycles
  // accept either an API key (sk-ant-api*) or a subscription OAuth
  // token (sk-ant-oat*); we route to the right env var per token type.
  // Sources, in order: env -> saved api.json -> interactive setup on TTY.
  const resolved = await resolveAnthropicKey({ autoSetup: true });
  const outboundAuth = resolved ? { key: resolved.key, envVar: resolved.envVar } : undefined;

  serveApi({
    ...cfg,
    outboundAuth,
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
      console.log(chalk.dim(`  cycle mode:         lightweight (--setting-sources=local + --strict-mcp-config)`));
      if (resolved) {
        const sourceLabel =
          resolved.source === "env" ? "env"
          : resolved.source === "saved" ? "saved in ~/.bajaclaw/api.json"
          : "minted via claude setup-token";
        const tokenKind = resolved.envVar === "CLAUDE_CODE_OAUTH_TOKEN" ? "OAuth (subscription)" : "API key";
        console.log(chalk.dim(`  outbound auth:      ${resolved.envVar} (${tokenKind}, ${sourceLabel})`));
      } else {
        console.log(chalk.yellow(`  WARNING: no Anthropic auth resolved. API cycles will 401 until you set one.`));
        if (isInteractive()) {
          console.log(chalk.yellow(`           Run \`bajaclaw setup-token\` to mint one (subscription users) or`));
          console.log(chalk.yellow(`           export ANTHROPIC_API_KEY (real API key) before starting serve.`));
        } else {
          console.log(chalk.yellow(`           Run \`bajaclaw setup-token\` on a TTY first, or export`));
          console.log(chalk.yellow(`           ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in this process's env.`));
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
