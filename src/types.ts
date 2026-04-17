export type Model =
  | "claude-opus-4-5"
  | "claude-sonnet-4-5"
  | "claude-haiku-4-5"
  | string;

export type Effort = "low" | "medium" | "high";

export interface ClaudeOptions {
  model?: Model;
  effort?: Effort;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpConfig?: string;
  workdir?: string;
  printMode?: boolean;
  systemPrompt?: string;
  timeout?: number;
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
  maxTurns: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  dashboardPort?: number;
  memorySync?: boolean;
  channels?: ChannelConfig[];
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
