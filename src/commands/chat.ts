// `bajaclaw chat [profile]` - interactive chat, React + Ink UI.
//
// v0.14.24+: the actual UI lives in chat-ui.tsx (React + Ink). This
// file is the thin entry point: validates the TTY, loads config +
// persona, resolves the model override, then mounts the <ChatApp/>
// component via ink's render(). The old readline-based implementation
// was deleted in this version. See chat-ui.tsx and HANDOFF.md
// landmine 17 for why.

import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { loadPersona } from "../persona-io.js";
import { AUTO, HAIKU, SONNET, OPUS } from "../model-picker.js";
import { ChatApp } from "./chat-ui.js";
import type { AgentConfig } from "../types.js";

const MODEL_ALIAS: Record<string, string> = {
  auto: AUTO,
  haiku: HAIKU,
  sonnet: SONNET,
  opus: OPUS,
};

export interface ChatOptions {
  profile: string;
  model?: string;
}

export async function runChat(opts: ChatOptions): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error(chalk.red("bajaclaw chat requires an interactive terminal."));
    console.error(chalk.dim("For scripted use: bajaclaw start --task \"<prompt>\""));
    process.exitCode = 1;
    return;
  }

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(opts.profile);
  } catch (e) {
    console.error(chalk.red(`error: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const persona = loadPersona(opts.profile);
  const agentName = (persona?.agentName ?? "baja").toLowerCase();
  const initialModelOverride = opts.model ? resolveModelAlias(opts.model) : undefined;

  const app = render(
    React.createElement(ChatApp, {
      profile: opts.profile,
      cfg,
      agentName,
      initialModelOverride,
    }),
    {
      // Ink's "alt-buffer" mode clears scrollback on exit. Keep stdin
      // in the foreground so the app receives key events.
      exitOnCtrlC: false,
    },
  );

  await app.waitUntilExit();
}

function resolveModelAlias(input: string): string {
  const lower = input.toLowerCase();
  if (lower in MODEL_ALIAS) return MODEL_ALIAS[lower]!;
  return input;
}
