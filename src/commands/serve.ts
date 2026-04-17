import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bajaclawHome } from "../paths.js";
import { serveApi } from "../api/server.js";
import type { ApiConfig } from "../api/server.js";

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

  serveApi({
    ...cfg,
    onReady: ({ host, port }) => {
      console.log(chalk.green(`✓ BajaClaw API listening on http://${host}:${port}/`));
      console.log(chalk.dim(`  OpenAI-compatible:  /v1/chat/completions  /v1/models`));
      console.log(chalk.dim(`  Native:             /v1/bajaclaw/cycle   /v1/bajaclaw/tasks`));
      if (cfg.apiKey) console.log(chalk.dim(`  auth: Bearer token required`));
      else if (host !== "127.0.0.1" && host !== "localhost") {
        console.log(chalk.yellow(`  WARNING: auth disabled on non-localhost bind`));
      } else {
        console.log(chalk.dim(`  auth: none (localhost-only)`));
      }
      if (cfg.exposedProfiles?.length) {
        console.log(chalk.dim(`  exposed profiles: ${cfg.exposedProfiles.join(", ")}`));
      } else {
        console.log(chalk.dim(`  exposed profiles: all`));
      }
    },
  });
  // Keep the process alive.
  await new Promise(() => {});
}

export function userApiConfigPath(): string {
  return join(bajaclawHome(), "api.json");
}

interface ApiFileCfg extends ApiConfig {}

export function loadUserApiConfig(): ApiFileCfg {
  const p = userApiConfigPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as ApiFileCfg; }
  catch { return {}; }
}
