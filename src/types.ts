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

// Mid-cycle narration level. Controls how chatty the orchestrator
// gets about what the agent is doing WHILE it runs.
//   "off"    - no narration, just the final reply
//   "medium" - phase-changing events only: skills, web search, subagents,
//              longer bash (builds/tests), writes. Reads are not narrated.
//   "full"   - every tool use: reads, edits, every bash
// Narration comes from BajaClaw watching the claude stream - it does
// NOT cost agent output tokens. Channel adapters that support message
// edit (Telegram, Discord) update ONE message in place; iMessage
// prepends a summary to the final reply since sent messages there
// cannot be edited by an unsigned process.
export type Verbosity = "off" | "medium" | "full";

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
  // Extra env vars merged on top of the (scrubbed) inherited env. Used
  // by runCycle to tell the spawned agent which profile/source/port to
  // target when it calls `bajaclaw say` for progress updates.
  env?: Record<string, string>;
  // Pass --bare to the claude CLI. Strips host-machine sluttery
  // (CLAUDE.md auto-discovery, hooks, plugin sync, attribution,
  // auto-memory, background prefetches, keychain reads) and forces
  // strict ANTHROPIC_API_KEY / apiKeyHelper auth (OAuth + keychain are
  // never read). Subscription OAuth tokens (`sk-ant-oat*`) DO NOT work
  // under --bare; use `lightweight` instead for OAuth-friendly hygiene.
  bare?: boolean;
  // Lightweight mode: emits `--setting-sources=local --strict-mcp-config
  // --no-session-persistence`. Suppresses the user-level CLAUDE.md and
  // user-level settings (hooks live there) while leaving OAuth +
  // keychain auth working. The OpenAI endpoint uses this so subscription
  // users get host-state hygiene without the --bare auth-tightening.
  // Verified empirically that user-level CLAUDE.md content does not
  // appear in the cycle's context when this is set.
  lightweight?: boolean;
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
  // If true (default), the daemon starts the local dashboard HTTP
  // server alongside the gateway when it boots. Set to false to opt
  // out - e.g. if you prefer to run `bajaclaw dashboard` manually,
  // or if the port conflicts with something you don't want evicted.
  dashboardAutostart?: boolean;
  memorySync?: boolean;
  channels?: ChannelConfig[];
  // Per-profile context window. Default: 200k. Set to "1m" to opt in
  // to Opus's 1-million-token window (API-key auth only).
  contextWindow?: ContextWindow;
  // Narration level for mid-cycle progress (what tools the agent is
  // calling). Default: "medium". See the Verbosity type above.
  verbosity?: Verbosity;
  // Per-cycle cost ceiling in USD. `undefined` = no cap.
  maxBudgetUsd?: number;
  // Inactivity timeout in milliseconds for streaming cycles. The subprocess is
  // killed only if no output is received for this duration - not after a fixed
  // wall-clock time. Active cycles can run indefinitely. Default: 10 min (600000).
  cycleTimeoutMs?: number;
  // Extra claude beta flags to include verbatim.
  betas?: string[];
  // When true, the desktop CLI's MCP config is merged into the cycle
  // subprocess. Off by default - BajaClaw keeps its own MCP config separate.
  mergeDesktopMcp?: boolean;
  // Curator: idle-triggered library consolidation. Replaces the old
  // post-cycle auto-skiller. See docs/specs/2026-05-05-self-learning-skills-design.md.
  curator?: CuratorConfig;
  // Skill selection: kept for slash-trigger hint generation. The LLM
  // matcher route is removed in v0.21+; the agent reads skills via the
  // system-prompt index and skill_view MCP tool.
  skillMatcher?: "llm" | "keyword";
  // Sub-agent relationships. Set on the parent to list owned sub-agents
  // (used by `bajaclaw subagent list`). Set on the child to point at its
  // orchestrator.
  parent?: string;
  subAgents?: string[];
  // Memory-compaction policy. Keeps the memory pool lean so recall stays
  // sharp and DB size stays bounded as the agent learns over time.
  compaction?: CompactionConfig;
  // Per-cycle shadow-git snapshots. When enabled, every cycle commits
  // the snapshot root before and after running so the user can rewind
  // a cycle from the dashboard or `bajaclaw rewind`. Off by default.
  // `root` defaults to the profile's workdir; set explicitly to
  // protect a different folder (e.g. the user's project repo).
  snapshots?: {
    enabled?: boolean;
    root?: string;
  };
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
  kind: "telegram" | "discord" | "imessage";
  // iMessage has no token (Messages.app owns auth via the Mac's Apple ID),
  // so this is optional on the type and validated per-kind in the adapter.
  token?: string;
  channelId?: string;
  // For telegram/discord: user/channel ids. For iMessage: the set of
  // handles (phone numbers or email addresses) whose inbound messages
  // should route to this profile. Empty allowlist on iMessage means
  // "any handle" - dangerous; the CLI warns.
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

  // ── Optional metadata ─────────────────────────────────────────────
  // `origin` is derived from which metadata block is present in the
  // frontmatter: `metadata.openclaw`/`clawdbot`/`clawdis` → "openclaw",
  // otherwise "bajaclaw".
  origin?: SkillOrigin;
  // platform list (top-level `platforms` or openclaw `os`). Values:
  // "macos" | "linux" | "windows" | "darwin". Skill is skipped at load
  // time if the current platform isn't in the list.
  platforms?: string[];
  tags?: string[];
  homepage?: string;
  emoji?: string;
  primaryEnv?: string;
  // env vars the skill expects. Normalized from openclaw `requires.env`
  // or top-level `required_environment_variables[].name`.
  requiredEnv?: string[];
  // openclaw `requires.bins` - all must be on PATH.
  requiredBins?: string[];
  // openclaw `requires.anyBins` - at least one must be on PATH.
  anyBins?: string[];
  // Conditional activation: skill becomes invisible to the index when
  // the listed tool/toolset is/isn't present in the current session.
  requiresTools?: string[];
  requiresToolsets?: string[];
  fallbackForTools?: string[];
  fallbackForToolsets?: string[];
  // openclaw install specs.
  install?: SkillInstallSpec[];
  // metadata.bajaclaw.related_skills.
  related?: string[];
  // true when this skill was auto-generated by skill_manage.
  autoGenerated?: boolean;
}

export type SkillOrigin = "bajaclaw" | "openclaw";

export interface SkillInstallSpec {
  kind: "brew" | "node" | "go" | "uv";
  // Format-dependent identifier. `formula` (brew), `package` (node/uv),
  // `module` (go). Kept loose because openclaw install specs evolve.
  formula?: string;
  package?: string;
  module?: string;
  bins?: string[];
  label?: string;
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

// ── Self-learning skills ──────────────────────────────────────────────

export type SkillProvenance = "agent" | "user" | "bundled";
export type SkillState = "active" | "stale" | "archived";

export interface SkillUsageEntry {
  use_count: number;
  view_count: number;
  patch_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  last_patched_at: string | null;
  created_at: string;
  state: SkillState;
  pinned: boolean;
  provenance: SkillProvenance;
}

export interface SkillDeletedEntry {
  absorbed_into: string;
  deleted_at: string;
  reason?: string;
}

export interface SkillSidecar {
  schema_version: 1;
  skills: Record<string, SkillUsageEntry>;
  deleted: Record<string, SkillDeletedEntry>;
}

export interface CuratorConfig {
  enabled?: boolean;
  intervalHours?: number;
  dryRun?: boolean;
  minIdleHours?: number;
  maxActionsPerRun?: number;
}

export interface CuratorState {
  last_curator_at: string | null;
  first_run_marker_at: string | null;
  dry_run_count: number;
}

export type CuratorActionKind =
  | "merge"
  | "create_umbrella"
  | "demote_to_references"
  | "prune";

export interface CuratorProposedAction {
  kind: CuratorActionKind;
  rationale: string;
  skills?: string[];
  into?: string;
  children?: string[];
  umbrella_name?: string;
  children_become?: "references";
  target_skill?: string;
  skill?: string;
}
