// Delegate coding-heavy work to a dedicated CLI sub-session.
// Orchestrating BajaClaw agents never write code directly — they call this.
import { runOnce } from "./claude.js";
import type { ClaudeOptions, ClaudeResult } from "./types.js";

export interface DelegateOptions extends ClaudeOptions {
  // The directory the sub-session will treat as cwd / workspace.
  workdir: string;
}

export async function delegateCoding(task: string, opts: DelegateOptions): Promise<ClaudeResult> {
  const merged: ClaudeOptions = {
    model: opts.model ?? "claude-sonnet-4-5",
    effort: opts.effort ?? "high",
    maxTurns: opts.maxTurns ?? 40,
    allowedTools: opts.allowedTools ?? ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
    disallowedTools: opts.disallowedTools,
    mcpConfig: opts.mcpConfig,
    workdir: opts.workdir,
    printMode: true,
    systemPrompt: opts.systemPrompt ?? "You are a coding sub-agent invoked by BajaClaw. Complete the task, then summarize what you changed in the final message.",
    timeout: opts.timeout ?? 30 * 60 * 1000,
  };
  return runOnce(task, merged);
}

// Backward-compatible alias for the older name.
export const delegateToClaudeCode = delegateCoding;
