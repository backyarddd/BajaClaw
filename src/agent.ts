// 13-step cycle loop.
// Steps:
//  1. Load profile config
//  2. Open DB + check schema
//  3. Circuit-breaker + rate-limit gate
//  4. Select task from queue or heartbeat trigger
//  5. Recall relevant memories (FTS5)
//  6. Load AGENT.md, SOUL.md, HEARTBEAT.md
//  7. Match skills against task, inject top N
//  8. Build MCP config for subprocess
//  9. Assemble final prompt
// 10. Invoke the CLI backend (print mode, JSON output)
// 11. Parse response, persist cycle row
// 12. Extract durable memories (post-cycle)
// 13. Dispatch follow-up actions (channel replies, queued tasks, self-improve reflection)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { Logger } from "./logger.js";
import { runOnce } from "./claude.js";
import { profileDir } from "./paths.js";
import { shouldAllow, rateLimit, recordFailure, recordSuccess } from "./safety.js";
import { recall } from "./memory/recall.js";
import { extract } from "./memory/extract.js";
import { syncFromClaude } from "./memory/claude-compat.js";
import { shouldCompact, compact as compactMemory } from "./memory/compact.js";
import { loadAllSkills } from "./skills/loader.js";
import { matchSkills } from "./skills/matcher.js";
import { synthesize as synthesizeSkill } from "./skills/auto-skiller.js";
import { broadcastToProfile } from "./channels/gateway.js";
import { buildMcpConfig } from "./mcp/consumer.js";
import { pickModel, budgetFor } from "./model-picker.js";
import { serialize } from "./concurrency.js";
import type { AgentConfig, ClaudeOptions, ChatTurn } from "./types.js";

export interface CycleInput {
  profile: string;
  task?: string;
  dryRun?: boolean;
  // If set, overrides the profile's configured model for this one cycle.
  // Use "auto" to force auto-routing; any other string is passed verbatim
  // to the backend. Used by the HTTP API to support per-request model.
  modelOverride?: string;
  // Optional. When provided, the prior turns are rendered into a
  // "Recent Chat" section of the prompt so interactive chat preserves
  // context within a session without waiting on the post-cycle
  // extractor to populate durable memory. Newest turn last.
  sessionHistory?: ChatTurn[];
  // Local file paths to images attached to this task (from Telegram,
  // Discord, or the CLI). Paths are appended to the prompt so the
  // agent can view them with the Read tool.
  attachments?: string[];
}

export interface CycleOutput {
  cycleId: number;
  ok: boolean;
  text: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
  model?: string;
  tier?: "haiku" | "sonnet" | "opus";
  durationMs: number;
  dryRun?: boolean;
  prompt: string;
  command?: string[];
  error?: string;
  // Set when the task came from an inbound channel (telegram/discord).
  // Format: "<kind>:<id>" - passed to channels/gateway.replyToSource.
  source?: string;
}

export async function runCycle(input: CycleInput): Promise<CycleOutput> {
  // Serialize cycles per-profile within this process. Prevents the HTTP
  // API from spawning parallel `claude` subprocesses under load.
  return serialize(input.profile, () => runCycleInner(input));
}

async function runCycleInner(input: CycleInput): Promise<CycleOutput> {
  const cfg = loadConfig(input.profile);
  const db = openDb(input.profile);
  const log = new Logger(input.profile);
  const started = new Date().toISOString();

  try {
    const gate = shouldAllow(db);
    if (!gate.allow) throw new Error(gate.reason ?? "breaker");
    const limit = rateLimit(db);
    if (!limit.allow) throw new Error(`rate limit exceeded (${limit.used}/hr)`);

    const heartbeatDefault = "Heartbeat check. Review state, note anything worth action, and return a brief summary.";
    const popped = input.task ? null : popTask(db);
    const task = input.task ?? popped?.body ?? heartbeatDefault;
    const isHeartbeat = task === heartbeatDefault;
    const attachments = input.attachments ?? popped?.attachments;

    if (cfg.memorySync) syncFromClaude(db, log);

    // Memory compaction. Cheap pre-cycle check; heavy work only if a
    // trigger fires (size > threshold × context window, or daily UTC
    // time passed since last compaction). Skipped on dry runs so
    // --dry-run never spawns extract/summarize backend calls.
    if (!input.dryRun) {
      const decision = shouldCompact(db, cfg.compaction);
      if (decision.yes) {
        log.info("compact.trigger", { reason: decision.reason });
        try {
          const r = await compactMemory(db, cfg.compaction, log);
          log.info("compact.done", {
            before: r.memoriesBefore,
            after: r.memoriesAfter,
            cyclesPruned: r.cyclesPruned,
            durationMs: r.durationMs,
          });
        } catch (e) {
          log.warn("compact.fail", { error: (e as Error).message });
        }
      }
    }

    // Pick the model. Per-request override wins over profile config.
    const effectiveModel = input.modelOverride ?? cfg.model;
    const picked = pickModel({
      configuredModel: effectiveModel,
      task,
      source: isHeartbeat ? "heartbeat" : undefined,
    });
    const budget = budgetFor(picked.tier);

    // Tiered context: trivial cycles get less prompt, opus cycles get more.
    const memories = recall(db, task, budget.memoryCount);
    const systemDocs = loadSystemDocs(input.profile);
    const allSkills = loadAllSkills(input.profile);
    const matched = matchSkills(allSkills, task, budget.skillCount, { allowedTools: cfg.allowedTools });
    const autoMatched = matched.filter((s) => s.autoGenerated);
    if (autoMatched.length > 0) {
      broadcastToProfile(input.profile, `Using skill: ${autoMatched.map((s) => s.name).join(", ")}`);
    }
    const mcpConfig = buildMcpConfig(input.profile);

    // For channel-sourced cycles (telegram, discord, etc.), auto-load
    // the recent back-and-forth with this source so the agent doesn't
    // treat every message as a cold start. In-process callers (chat
    // REPL, dashboard /api/chat) already pass their own sessionHistory;
    // that takes precedence.
    const sessionHistory = input.sessionHistory
      ?? (popped?.source ? loadSourceHistory(db, popped.source, popped.id, 8) : undefined);

    const prompt = assemblePrompt({
      task,
      attachments,
      memories: memories
        .map((m) => `- [${m.kind}] ${m.content.slice(0, budget.memoryCharsEach)}`)
        .join("\n"),
      agentMd: systemDocs.agent,
      soulMd: systemDocs.soul,
      heartbeat: isHeartbeat ? systemDocs.heartbeat : "",
      skills: matched
        .map((s) => `## Skill: ${s.name}\n${s.body}`)
        .join("\n\n"),
      recentChat: formatRecentChat(sessionHistory),
    });

    const cycleId = insertCycle(db, {
      started_at: started,
      status: "running",
      task,
      prompt_preview: prompt.slice(0, 300),
    });

    log.info("cycle.start", {
      cycleId,
      task: task.slice(0, 80),
      model: picked.model,
      tier: picked.tier,
      reason: picked.reason,
    });

    // claude's --effort level is the real knob for "how much runway
    // does the agent get". No --max-turns flag exists in claude CLI;
    // `effort: "max"` gives the biggest internal turn budget.
    const opts: ClaudeOptions & { dryRun?: boolean } = {
      model: picked.model,
      effort: cfg.effort,
      allowedTools: cfg.allowedTools,
      disallowedTools: cfg.disallowedTools,
      mcpConfig,
      workdir: profileDir(input.profile),
      printMode: true,
      betas: cfg.betas,
      context1M: cfg.contextWindow === "1m",
      maxBudgetUsd: cfg.maxBudgetUsd,
      dryRun: input.dryRun,
    };

    const result = await runOnce(prompt, opts);
    const finished = new Date().toISOString();

    if (!result.ok) {
      recordFailure(db);
      db.prepare(
        "UPDATE cycles SET finished_at=?, status=?, error=?, response_preview=? WHERE id=?"
      ).run(finished, "error", result.error ?? "unknown", result.text.slice(0, 500), cycleId);
      if (popped) {
        db.prepare("UPDATE tasks SET status='error', cycle_id=? WHERE id=?").run(cycleId, popped.id);
      }
      log.error("cycle.fail", { cycleId, error: result.error });
      return {
        cycleId,
        ok: false,
        text: result.text,
        durationMs: result.durationMs,
        model: picked.model,
        tier: picked.tier,
        prompt,
        command: result.command,
        error: result.error,
        source: popped?.source,
      };
    }

    recordSuccess(db);
    // Store up to 8k chars of the response. Needed for conversational
    // history on channel-sourced cycles - the old 300-char cap made
    // every prior turn look like a stub. 8k ≈ 2k tokens; beyond that
    // we rely on memory extraction to preserve context.
    db.prepare(
      "UPDATE cycles SET finished_at=?, status=?, response_preview=?, cost_usd=?, input_tokens=?, output_tokens=?, turns=? WHERE id=?"
    ).run(
      finished,
      "ok",
      result.text.slice(0, 8000),
      result.costUsd ?? null,
      result.inputTokens ?? null,
      result.outputTokens ?? null,
      result.turns ?? null,
      cycleId,
    );
    if (popped) {
      db.prepare("UPDATE tasks SET status='done', cycle_id=? WHERE id=?").run(cycleId, popped.id);
    }

    // Post-cycle memory extraction + auto-skill synthesis. Both are extra
    // backend calls - skip them on cheap (Haiku) cycles and on trivially
    // short responses to keep token usage tight.
    const shouldDoPostWork = !result.dryRun && result.text.length >= 120 && picked.tier !== "haiku";
    if (shouldDoPostWork) {
      try { await extract(db, cycleId, task, result.text, cfg); }
      catch (e) { log.warn("memory.extract.fail", { error: (e as Error).message }); }

      try {
        const as = await synthesizeSkill({
          cycleId,
          task,
          response: result.text,
          events: result.events,
          cfg: cfg.autoSkill,
        }, log);
        if (as.wrote) {
          log.info("auto-skill.wrote", { path: as.wrote, cycleId });
          const skillName = as.wrote.split("/").slice(-2, -1)[0] ?? "unknown";
          broadcastToProfile(input.profile, `Learned new skill: ${skillName}`);
        }
      } catch (e) {
        log.warn("auto-skill.fail", { error: (e as Error).message });
      }
    }

    log.info("cycle.ok", { cycleId, costUsd: result.costUsd, turns: result.turns });

    return {
      cycleId,
      ok: true,
      text: result.text,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      turns: result.turns,
      model: picked.model,
      tier: picked.tier,
      durationMs: result.durationMs,
      dryRun: result.dryRun,
      prompt,
      command: result.command,
      source: popped?.source,
    };
  } finally {
    db.close();
  }
}

function formatRecentChat(history?: ChatTurn[]): string {
  if (!history || history.length === 0) return "";
  return history
    .map((t) => {
      const role = t.role === "user" ? "User" : "Assistant";
      return `**${role}**: ${t.content.slice(0, 1200)}`;
    })
    .join("\n\n");
}

function popTask(db: import("./db.js").DB): { id: number; body: string; source?: string; attachments?: string[] } | null {
  const row = db.prepare(
    "SELECT id, body, source, attachments FROM tasks WHERE status='pending' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at ASC LIMIT 1"
  ).get() as { id: number; body: string; source: string | null; attachments: string | null } | undefined;
  if (!row) return null;
  db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(row.id);
  return {
    id: row.id,
    body: row.body,
    source: row.source ?? undefined,
    attachments: row.attachments ? JSON.parse(row.attachments) as string[] : undefined,
  };
}

/** Build a conversation history window for a given source
 *  (telegram:<id>, discord:<id>, etc.) by joining finished tasks to
 *  their cycles and emitting user/assistant turn pairs in chronological
 *  order. Used by channel-sourced cycles so the agent can see what
 *  was already said instead of treating every message as a cold
 *  start. Excludes the currently-running task. */
function loadSourceHistory(
  db: import("./db.js").DB,
  source: string,
  currentTaskId: number,
  limit: number,
): ChatTurn[] {
  const rows = db.prepare(`
    SELECT t.id AS task_id, t.body AS user_msg, t.created_at AS user_ts,
           c.response_preview AS agent_msg, c.finished_at AS agent_ts
    FROM tasks t
    LEFT JOIN cycles c ON c.id = t.cycle_id
    WHERE t.source = ?
      AND t.id != ?
      AND t.status = 'done'
      AND c.status = 'ok'
    ORDER BY t.id DESC
    LIMIT ?
  `).all(source, currentTaskId, limit) as {
    task_id: number;
    user_msg: string;
    user_ts: string;
    agent_msg: string | null;
    agent_ts: string | null;
  }[];

  const turns: ChatTurn[] = [];
  for (const r of rows.reverse()) {
    turns.push({ role: "user", content: r.user_msg, ts: Date.parse(r.user_ts) || 0 });
    if (r.agent_msg) {
      turns.push({ role: "assistant", content: r.agent_msg, ts: Date.parse(r.agent_ts ?? r.user_ts) || 0 });
    }
  }
  return turns;
}

function insertCycle(db: import("./db.js").DB, c: {
  started_at: string; status: "running"; task: string; prompt_preview: string;
}): number {
  const info = db.prepare(
    "INSERT INTO cycles(started_at,status,task,prompt_preview) VALUES(?,?,?,?)"
  ).run(c.started_at, c.status, c.task, c.prompt_preview);
  return info.lastInsertRowid as number;
}

function loadSystemDocs(profile: string): { agent: string; soul: string; heartbeat: string } {
  const dir = profileDir(profile);
  const read = (name: string) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  // AGENT.md is the canonical name. Fall back to the older CLAUDE.md for
  // migrated profiles.
  const agent = read("AGENT.md") || read("CLAUDE.md");
  return {
    agent,
    soul: read("SOUL.md"),
    heartbeat: read("HEARTBEAT.md"),
  };
}

interface AssembleInput {
  task: string;
  attachments?: string[];
  memories: string;
  agentMd: string;
  soulMd: string;
  heartbeat: string;
  skills: string;
  recentChat?: string;
}

export function assemblePrompt(input: AssembleInput): string {
  const sections: string[] = [];
  if (input.soulMd.trim()) sections.push(`# Agent Identity\n${input.soulMd.trim()}`);
  if (input.agentMd.trim()) sections.push(`# Operating Guide\n${input.agentMd.trim()}`);
  if (input.heartbeat.trim()) sections.push(`# Heartbeat Schedule\n${input.heartbeat.trim()}`);
  if (input.memories.trim()) sections.push(`# Recalled Memories\n${input.memories.trim()}`);
  if (input.skills.trim()) sections.push(`# Active Skills\n${input.skills.trim()}`);
  if (input.recentChat?.trim()) sections.push(`# Recent Chat\n${input.recentChat.trim()}`);

  let taskSection = input.task.trim();
  if (input.attachments?.length) {
    const paths = input.attachments.map((p) => `- ${p}`).join("\n");
    taskSection += `\n\n[Images attached - use the Read tool to view each file:\n${paths}\n]`;
  }
  sections.push(`# Current Task\n${taskSection}`);
  return sections.join("\n\n---\n\n");
}

// Re-export for consumers that want a typed AgentConfig without importing config.ts directly.
export type { AgentConfig };
