export type Model =
  | "auto"
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | string;

// claude CLI's `--effort` accepts these five levels. Higher levels
// give the agent a larger internal turn budget and more time / tokens
// to finish a task. `max` is the most generous.
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Which context window the backend should use. "1m" adds the
// `context-1m-2025-08-07` beta header; requires API-key auth (the
// CLI prints a warning and falls back to 200k for subscription users).
export type ContextWindow = "200k" | "1m";

export interface ClaudeOptions {
  model?: Model;
  effort?: Effort;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfig?: string;
  workdir?: string;
  printMode?: boolean;
  systemPrompt?: string;
  timeout?: number;
  // Beta flags to pass via `--betas` (claude CLI, API-key users only).
  // The most common is `context-1m-2025-08-07` for 1M context.
  betas?: string[];
  // Opt in to the 1M context window. Equivalent to adding
  // `context-1m-2025-08-07` to `betas`. Ignored for subscription auth.
  context1M?: boolean;
  // Hard per-cycle cost ceiling in USD (maps to `--max-budget-usd`).
  // The cycle aborts cleanly if it would exceed this. `undefined` = no cap.
  maxBudgetUsd?: number;
  // Skip claude's interactive permission prompts for tools like Edit/Bash.
  // Default true: BajaClaw closes stdin when invoking claude, so
  // interactive prompts would just fail anyway. Set false only when you
  // explicitly want cycles to abort on sensitive tool use.
  skipPermissions?: boolean;
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
  events: ClaudeEvent[];
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
  durationMs: number;
  dryRun?: boolean;
  command?: string[];
  error?: string;
}

export interface ClaudeEvent {
  type: "text" | "tool_use" | "tool_result" | "assistant" | "system" | "result" | "user";
  content?: unknown;
  [k: string]: unknown;
}

export interface AgentConfig {
  name: string;
  profile: string;
  template: string;
  model: Model;
  effort: Effort;
  /** @deprecated claude CLI has no --max-turns flag. Ignored. Use `effort: "max"` for biggest turn budget. */
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  dashboardPort?: number;
  memorySync?: boolean;
  channels?: ChannelConfig[];
  // Per-profile context window. Default: 200k. Set to "1m" to opt in
  // to Opus's 1-million-token window (API-key auth only).
  contextWindow?: ContextWindow;
  // Per-cycle cost ceiling in USD. `undefined` = no cap.
  maxBudgetUsd?: number;
  // Extra claude beta flags to include verbatim.
  betas?: string[];
  // When true, the desktop CLI's MCP config is merged into the cycle
  // subprocess. Off by default — BajaClaw keeps its own MCP config separate.
  mergeDesktopMcp?: boolean;
  // Per-cycle auto-skill synthesis settings (inspired by the "skill after
  // complex tasks" pattern). Override defaults here per profile.
  autoSkill?: {
    enabled?: boolean;
    minToolUses?: number;
    maxPerDay?: number;
  };
  // Sub-agent relationships. Set on the parent to list owned sub-agents
  // (used by `bajaclaw subagent list`). Set on the child to point at its
  // orchestrator.
  parent?: string;
  subAgents?: string[];
  // Memory-compaction policy. Keeps the memory pool lean so recall stays
  // sharp and DB size stays bounded as the agent learns over time.
  compaction?: CompactionConfig;
}

export interface CompactionConfig {
  enabled?: boolean;
  // Fraction of the reference context window (200k tokens ≈ 800k chars)
  // that the memory pool can fill before threshold compaction fires.
  threshold?: number;
  // "threshold": only when the pool is oversized.
  // "daily": only at the daily UTC time.
  // "both": either trigger.
  // "off": disable entirely (same as enabled=false).
  schedule?: "threshold" | "daily" | "both" | "off";
  // HH:MM (24h, UTC) for the daily trigger.
  dailyAtUtc?: string;
  // How many newest memories per kind to keep verbatim. Older ones in a
  // kind are eligible for summary compression.
  keepRecentPerKind?: number;
  // Drop cycle log rows older than this (days). 0 disables pruning.
  pruneCycleDays?: number;
}

export interface ChannelConfig {
  kind: "telegram" | "discord";
  token: string;
  channelId?: string;
  allowlist?: (string | number)[];
}

export interface Skill {
  name: string;
  description: string;
  version?: string;
  tools?: string[];
  triggers?: string[];
  effort?: Effort;
  body: string;
  path: string;
  scope: SkillScope;
}

export type SkillScope =
  | "agent"
  | "bajaclaw-user"
  | "bajaclaw-builtin"
  | "claude-user"
  | "claude-project";

export interface Memory {
  id: number;
  kind: string;
  content: string;
  source: string;
  source_cycle_id?: number;
  created_at: string;
}

export interface ScheduleEntry {
  id?: number;
  cron: string;
  task: string;
  enabled: number;
  last_run?: string;
  next_run?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

export interface CycleRow {
  id: number;
  started_at: string;
  finished_at?: string;
  status: "running" | "ok" | "error";
  task: string;
  prompt_preview: string;
  response_preview?: string;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  turns?: number;
  error?: string;
}
