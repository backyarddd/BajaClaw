// React + Ink UI for `bajaclaw chat`.
//
// Replaces the old readline-based REPL (v0.14.23 and earlier). Prior
// versions fought readline's `_refreshLine` cursor model to draw a
// bordered "sandwich" around the input; see HANDOFF.md landmine 17.
// Ink sidesteps all of that — it owns the render loop, diffs each
// frame, and lets us describe the UI declaratively.
//
// Layout, top to bottom:
//
//   <Static> region, printed once at mount and left alone:
//     - ASCII banner
//     - identity block (agent, model, effort, ctx, version, cwd)
//     - usage line (5h / week)
//     - /help reminder
//
//   <Static> region, one entry per completed turn (plain lines that
//   scroll with the terminal exactly like the old output):
//     - ` › user input`
//     - `● agent response`
//     - `  model · effort · tokens · time · cost · #id`
//     - error entries
//     - slash-command output
//
//   Dynamic region (bottom, rerenders on state change):
//     - Thinking indicator (spinner + elapsed + model) while a cycle
//       runs.
//     - Bordered composer box with the prompt + input.
//     - One-line status bar showing model/effort/ctx + session totals.
//
// Bracketed-paste support and attachments carry over from the old
// code. Ink's default input handling drops embedded newlines; we
// accept that limit (same as readline's single-line mode).

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCycle, type CycleOutput } from "../agent.js";
import { saveConfig } from "../config.js";
import { openDb, type DB } from "../db.js";
import { tierFor, budgetFor, AUTO, HAIKU, SONNET, OPUS } from "../model-picker.js";
import { currentVersion } from "../updater.js";
import type { AgentConfig, ChatTurn } from "../types.js";

const HISTORY_LIMIT = 10;

// Slash command catalog, driven the autocomplete popover. The `name`
// is the token typed after the `/`; `hint` is what each dropdown row
// shows; `args` is an optional usage suffix (e.g. "[200k|1m]").
interface SlashDef {
  name: string;
  aliases?: string[];
  hint: string;
  args?: string;
}

const SLASH_COMMANDS: SlashDef[] = [
  { name: "help", aliases: ["?"], hint: "list all commands" },
  { name: "exit", aliases: ["quit", "q"], hint: "end the session" },
  { name: "clear", hint: "clear session history (memory DB untouched)" },
  { name: "stats", hint: "session totals + 5h/24h/7d usage" },
  { name: "context", aliases: ["ctx"], hint: "show or set context window", args: "[200k|1m]" },
  { name: "model", hint: "show or set session model", args: "[auto|haiku|sonnet|opus]" },
  { name: "effort", hint: "show or set effort level", args: "[low|medium|high|xhigh|max]" },
  { name: "compact", hint: "run memory compaction now" },
  { name: "image", aliases: ["img"], hint: "queue an image for your next message", args: "<path>" },
  { name: "video", aliases: ["vid"], hint: "extract video frames and queue them", args: "<path>" },
  { name: "history", hint: "reminder pointer to the dashboard" },
];

// Return the commands that match the currently typed prefix. `/` on
// its own shows everything; `/mo` narrows to `model`.
function matchCommands(token: string): SlashDef[] {
  const lower = token.toLowerCase();
  return SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(lower) || (c.aliases?.some((a) => a.startsWith(lower)) ?? false),
  );
}

const MODEL_ALIAS: Record<string, string> = {
  auto: AUTO,
  haiku: HAIKU,
  sonnet: SONNET,
  opus: OPUS,
};

const CTX_TOKENS_200K: Record<"haiku" | "sonnet" | "opus", number> = {
  haiku: 200_000,
  sonnet: 200_000,
  opus: 200_000,
};
const CTX_TOKENS_1M = 1_000_000;

const BANNER = [
  " ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗",
  " ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║",
  " ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║",
  " ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║",
  " ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝",
  " ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝",
];

interface SessionStats {
  started: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageWindow {
  cycles: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// Each completed item in the scrollback. Rendered via <Static> so it
// only ever writes once per append — no re-render when the composer
// state changes, keeps scrollback clean.
//
// Ink 7 renders only the LAST <Static> component in the tree, so the
// banner + identity block live in this same list as the first entry
// (`kind: "intro"`) instead of a separate Static.
type TurnEntry =
  | { id: number; kind: "intro"; agentName: string; profile: string; cfg: AgentConfig; modelOverride?: string; usage: { fiveH: UsageWindow; week: UsageWindow } }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "agent"; text: string; meta: string }
  | { id: number; kind: "error"; text: string; raw?: string; meta?: string; drill?: string }
  | { id: number; kind: "system"; lines: { text: string; color?: string; dim?: boolean }[] };

export interface ChatAppProps {
  profile: string;
  cfg: AgentConfig;
  agentName: string;
  initialModelOverride?: string;
}

export function ChatApp({
  profile,
  cfg: initialCfg,
  agentName,
  initialModelOverride,
}: ChatAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [cfg, setCfg] = useState<AgentConfig>(initialCfg);
  const [modelOverride, setModelOverride] = useState<string | undefined>(initialModelOverride);
  const [input, setInput] = useState("");
  // Seed the Static list with the intro entry on first render so the
  // banner + identity block land in scrollback. Ink 7 renders only
  // the LAST <Static> in the tree, so we use ONE Static for everything
  // — intro goes in the same list as the turns.
  const [turns, setTurns] = useState<TurnEntry[]>(() => {
    const db = openDb(profile);
    let usage: { fiveH: UsageWindow; week: UsageWindow };
    try {
      usage = { fiveH: usageWindow(db, 5), week: usageWindow(db, 24 * 7) };
    } finally {
      db.close();
    }
    return [
      {
        id: 1,
        kind: "intro",
        agentName,
        profile,
        cfg: initialCfg,
        modelOverride: initialModelOverride,
        usage,
      },
    ];
  });
  const [thinking, setThinking] = useState(false);
  const [thinkingStart, setThinkingStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<string[]>([]);
  // Ring of submitted inputs for ↑/↓ recall. Newest-last, slash
  // commands included so users can re-run `/stats` with one keystroke.
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  // Local message queue. If the user hits Enter while a cycle is in
  // flight, the message lands here instead of forcing them to wait.
  // Drained FIFO as soon as `thinking` flips false — see the useEffect
  // below.
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  const historyRef = useRef<ChatTurn[]>([]);
  const statsRef = useRef<SessionStats>({
    started: Date.now(),
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });
  const turnIdRef = useRef(1); // intro consumed id 1
  const thinkingModelRef = useRef<string>(modelOverride ?? cfg.model);
  // Thinking flag mirrored to a ref so handleSubmit (which closes over
  // the current render's state) always sees the live value when the
  // user types into the composer mid-cycle.
  const thinkingRef = useRef(false);

  // Tick elapsed time while a cycle is running, for the live
  // "thinking" indicator.
  useEffect(() => {
    if (!thinking) return;
    const i = setInterval(() => {
      setElapsed(Date.now() - thinkingStart);
    }, 100);
    return () => clearInterval(i);
  }, [thinking, thinkingStart]);

  // Ctrl-C / Ctrl-D exit. Registered as a top-level input handler so
  // it fires even while the composer's own useInput is active — Ink
  // delivers each key event to every registered handler.
  useInput((char, key) => {
    if (key.ctrl && (char === "c" || char === "d")) {
      printSessionSummary(stdout, statsRef.current);
      exit();
    }
  });

  const appendTurn = (t: TurnEntry): void => {
    setTurns((prev) => [...prev, t]);
  };

  const appendSystemLines = (lines: { text: string; color?: string; dim?: boolean }[]): void => {
    appendTurn({ id: nextId(turnIdRef), kind: "system", lines });
  };

  // Run one chat turn: append the user entry, kick off the cycle,
  // append the agent response. Called either directly from submit
  // (when idle) or from the queue-drain effect (when the previous
  // cycle finishes with queued messages waiting).
  const runTurn = async (trimmed: string): Promise<void> => {
    appendTurn({ id: nextId(turnIdRef), kind: "user", text: trimmed });

    if (trimmed.startsWith("/")) {
      await handleSlash(trimmed, {
        profile,
        cfg,
        setCfg,
        agentName,
        stats: statsRef.current,
        pendingAttachments,
        setPendingAttachments,
        getModel: () => modelOverride,
        setModel: (m) => setModelOverride(m),
        appendSystem: appendSystemLines,
        exit: () => {
          printSessionSummary(stdout, statsRef.current);
          exit();
        },
      });
      return;
    }

    historyRef.current.push({ role: "user", content: trimmed, ts: Date.now() });
    const attachmentsForTurn =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;
    if (attachmentsForTurn) setPendingAttachments([]);

    const effectiveModel = modelOverride ?? cfg.model;
    thinkingModelRef.current = effectiveModel;
    thinkingRef.current = true;
    setThinking(true);
    setThinkingStart(Date.now());
    setElapsed(0);

    let r: CycleOutput | null = null;
    let caughtError: Error | null = null;
    try {
      const recent = historyRef.current.slice(-HISTORY_LIMIT - 1, -1);
      r = await runCycle({
        profile,
        task: trimmed,
        modelOverride,
        sessionHistory: recent,
        attachments: attachmentsForTurn,
      });
    } catch (e) {
      caughtError = e as Error;
    }

    thinkingRef.current = false;
    setThinking(false);

    if (caughtError) {
      appendTurn({
        id: nextId(turnIdRef),
        kind: "error",
        text: `error: ${caughtError.message}`,
        raw: "(thrown before cycle started - check claude CLI install)",
      });
      historyRef.current.pop();
      return;
    }

    if (!r || !r.ok) {
      const metaBits: string[] = [];
      if (r?.model) metaBits.push(shortModel(r.model));
      if (r) metaBits.push(`${(r.durationMs / 1000).toFixed(1)}s`);
      if (r?.costUsd != null) metaBits.push(`$${r.costUsd.toFixed(4)}`);
      if (r?.turns != null) metaBits.push(`${r.turns} turn${r.turns === 1 ? "" : "s"}`);
      if (r) metaBits.push(`#${r.cycleId}`);

      const rawFirst = r?.error ? r.error.split("\n")[0]!.slice(0, 500) : undefined;
      const drill = r
        ? `drill: open http://localhost:${cfg.dashboardPort ?? 7337}/ → cycle #${r.cycleId}`
        : undefined;

      appendTurn({
        id: nextId(turnIdRef),
        kind: "error",
        text: formatCycleError(r),
        meta: metaBits.length > 0 ? metaBits.join(" · ") : undefined,
        raw: rawFirst ? `raw: ${rawFirst}` : undefined,
        drill,
      });
      historyRef.current.pop();
      return;
    }

    const responseText = (r.text ?? "").trim() || "(empty response)";
    const meta = buildStatusLine(r, cfg);
    appendTurn({ id: nextId(turnIdRef), kind: "agent", text: responseText, meta });

    historyRef.current.push({ role: "assistant", content: r.text ?? "", ts: Date.now() });
    statsRef.current.turnCount += 1;
    statsRef.current.inputTokens += r.inputTokens ?? 0;
    statsRef.current.outputTokens += r.outputTokens ?? 0;
    statsRef.current.costUsd += r.costUsd ?? 0;
  };

  // Submit dispatcher. Idle → run immediately; mid-cycle → enqueue.
  // The queued message is NOT appended to the turn scrollback yet (we
  // want the ordering to match reality: it'll appear as a user turn
  // right before its own cycle fires, drained by the effect below).
  const handleSubmit = (rawInput: string): void => {
    const trimmed = rawInput.trim();
    setInput("");
    if (!trimmed) return;

    setCommandHistory((prev) => {
      if (prev[prev.length - 1] === trimmed) return prev;
      const next = [...prev, trimmed];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });

    if (thinkingRef.current) {
      setMessageQueue((prev) => [...prev, trimmed]);
      return;
    }

    void runTurn(trimmed);
  };

  // Drain the queue when the current cycle finishes. Pull one message
  // off the front, fire it, and let the next `thinking` transition
  // trigger us again for the rest.
  useEffect(() => {
    if (thinking) return;
    if (messageQueue.length === 0) return;
    const [next, ...rest] = messageQueue;
    if (next === undefined) return;
    setMessageQueue(rest);
    void runTurn(next);
    // runTurn is stable-enough for our purposes; listing it as a dep
    // would recreate it every render and infinite-loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking, messageQueue]);

  return (
    <Box flexDirection="column">
      {/* Intro + turn history. <Static> appends each new entry once
          and never re-renders prior entries. The intro entry was
          seeded into state on mount. The second arg to the render
          function is the item's index — we use it to skip the
          separator on the very first turn after the intro. */}
      <Static items={turns}>
        {(t, i) => <TurnView key={t.id} turn={t} showSeparator={i > 0} />}
      </Static>

      {/* Thinking indicator lives ABOVE the composer now so the box
          stays visible for the whole cycle. Typing while thinking
          enqueues the message (see `handleSubmit`). */}
      {thinking && (
        <Box>
          <Text color="magenta">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> thinking · </Text>
          <Text dimColor>{shortModel(thinkingModelRef.current === AUTO ? SONNET : thinkingModelRef.current)}</Text>
          <Text dimColor> · {(elapsed / 1000).toFixed(1)}s</Text>
          {messageQueue.length > 0 && (
            <Text color="cyan"> · {messageQueue.length} queued</Text>
          )}
        </Box>
      )}

      {/* Show queued messages as dim preview lines so the user can see
          what's waiting to run. Indented to match the ` › ` prefix. */}
      {messageQueue.length > 0 && (
        <Box flexDirection="column">
          {messageQueue.map((m, i) => (
            <Box key={`queued-${i}`}>
              <Text color="cyan" dimColor>⧗ </Text>
              <Text dimColor>{m}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Composer
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        pendingAttachments={pendingAttachments}
        active={true}
        commandHistory={commandHistory}
        thinking={thinking}
      />

      <StatusBar
        stats={statsRef.current}
        pendingAttachments={pendingAttachments.length}
        modelOverride={modelOverride}
        initialModel={initialCfg.model}
        initialEffort={initialCfg.effort}
        cfg={cfg}
        queueLength={messageQueue.length}
      />
      <HintFooter hasInput={input.length > 0} isSlash={input.startsWith("/")} thinking={thinking} />
    </Box>
  );
}

// ── Turn rendering ─────────────────────────────────────────────────

// Each turn group (user input + agent response + stats, or a slash
// output block, or an error block) is separated from the previous by
// a dim horizontal rule so the wall of text doesn't blur together.
// The rule is NOT drawn above the first turn (the intro block below
// it already has its own trailing whitespace).
function TurnView({ turn, showSeparator }: { turn: TurnEntry; showSeparator: boolean }): React.ReactElement {
  const { stdout } = useStdout();
  // Ink's Static renders items detached from the main tree and
  // `useStdout().stdout.columns` can come back as 0 in that context.
  // Clamp to a sane floor so `.repeat(n)` never sees a negative.
  const rawCols = stdout?.columns ?? 80;
  const width = Math.max(20, Math.min(rawCols > 0 ? rawCols - 1 : 79, 120));
  const separator = showSeparator && turn.kind !== "intro"
    ? <Text dimColor>{"─".repeat(width)}</Text>
    : null;

  let body: React.ReactElement;
  switch (turn.kind) {
    case "intro":
      body = <Intro {...turn} />;
      break;
    case "user":
      body = (
        <Box>
          <Text color="cyan"> › </Text>
          <Text>{turn.text}</Text>
        </Box>
      );
      break;
    case "agent":
      body = (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">● </Text>
            <Text>{turn.text}</Text>
          </Box>
          <Text dimColor>  {turn.meta}</Text>
        </Box>
      );
      break;
    case "error":
      body = (
        <Box flexDirection="column">
          <Box>
            <Text color="red">● {turn.text}</Text>
          </Box>
          {turn.meta && <Text dimColor>  {turn.meta}</Text>}
          {turn.raw && <Text dimColor>  {turn.raw}</Text>}
          {turn.drill && <Text dimColor>  {turn.drill}</Text>}
        </Box>
      );
      break;
    case "system":
      body = (
        <Box flexDirection="column">
          {turn.lines.map((line, i) => (
            <Text
              key={i}
              color={line.color as Parameters<typeof Text>[0]["color"]}
              dimColor={line.dim}
            >
              {line.text}
            </Text>
          ))}
        </Box>
      );
      break;
  }

  return (
    <Box flexDirection="column">
      {separator}
      {body}
    </Box>
  );
}

// ── Intro block ───────────────────────────────────────────────────

function Intro({
  agentName,
  profile,
  cfg,
  modelOverride,
  usage,
}: Extract<TurnEntry, { kind: "intro" }>): React.ReactElement {
  const displayModel = modelOverride ?? cfg.model;
  const tier = tierFor(displayModel === AUTO ? SONNET : displayModel);
  const ctxTokens = cfg.contextWindow === "1m" ? CTX_TOKENS_1M : CTX_TOKENS_200K[tier];
  const version = currentVersion();
  return (
    <Box flexDirection="column">
      <Text> </Text>
      {BANNER.map((line, i) => (
        <Text color="cyan" key={`banner-${i}`}>{line}</Text>
      ))}
      <Text> </Text>
      <Box>
        <Text>  </Text>
        <Text bold>{agentName}</Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{displayModel}</Text>
      </Box>
      <Box>
        <Text>  </Text>
        <Text dimColor>profile: </Text>
        <Text>{profile}  </Text>
        <Text dimColor>effort: </Text>
        <Text>{cfg.effort}  </Text>
        <Text dimColor>ctx: </Text>
        {cfg.contextWindow === "1m" ? (
          <>
            <Text color="green">1M</Text>
            <Text dimColor> (beta)</Text>
          </>
        ) : (
          <Text>{formatNum(ctxTokens)}</Text>
        )}
      </Box>
      <Box>
        <Text>  </Text>
        <Text dimColor>version: </Text>
        <Text>{version}</Text>
      </Box>
      {cfg.maxBudgetUsd != null && (
        <Box>
          <Text>  </Text>
          <Text dimColor>budget: </Text>
          <Text>${cfg.maxBudgetUsd.toFixed(2)}/cycle</Text>
        </Box>
      )}
      <Text> </Text>
      <Box>
        <Text>  </Text>
        <Text dimColor>cwd: </Text>
        <Text>{process.cwd()}</Text>
      </Box>
      <Text> </Text>
      <Text dimColor>
        {"  usage  5h: " + formatWindow(usage.fiveH) + "    week: " + formatWindow(usage.week)}
      </Text>
      <Text dimColor>  /help for commands  ·  /exit or Ctrl-D to quit</Text>
      <Text> </Text>
    </Box>
  );
}

// ── Composer ───────────────────────────────────────────────────────

interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (v: string) => void | Promise<void>;
  pendingAttachments: string[];
  active: boolean;
  commandHistory: string[];
  thinking: boolean;
}

// Composer with slash-command autocomplete + input history.
//
// - When the input starts with "/", a dropdown of matching commands
//   renders below the box. Up/Down select, Tab completes to the
//   highlighted command, Enter submits.
// - When the input is empty OR doesn't start with "/", Up/Down cycles
//   through prior submitted inputs (like bash history).
//
// We own the cursor locally so arrow-left/right move within the line
// without the parent re-rendering. `input`/`setInput` are still
// controlled externally so the parent can clear on submit.
function Composer({ input, setInput, onSubmit, pendingAttachments, active, commandHistory, thinking }: ComposerProps): React.ReactElement {
  const [cursor, setCursor] = useState<number>(input.length);
  const [suggestIdx, setSuggestIdx] = useState<number>(0);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const draftRef = useRef<string>(""); // remembers in-progress input when scrolling history

  // Reset cursor/selection when the parent clears the input (after submit).
  useEffect(() => {
    if (input === "") {
      setCursor(0);
      setSuggestIdx(0);
      setHistoryIdx(null);
      draftRef.current = "";
    }
  }, [input]);

  // Compute autocomplete matches based on whether input looks like a slash token.
  const slashToken = input.startsWith("/") ? input.slice(1).split(/\s/)[0] ?? "" : null;
  const showSuggest = slashToken !== null;
  const matches = showSuggest ? matchCommands(slashToken) : [];
  const visibleMatches = matches.slice(0, 8);
  const hasSuggestions = showSuggest && visibleMatches.length > 0;
  // Clamp selected index when the match list shrinks.
  useEffect(() => {
    if (suggestIdx >= visibleMatches.length && visibleMatches.length > 0) {
      setSuggestIdx(0);
    }
  }, [suggestIdx, visibleMatches.length]);

  const applySuggestion = (cmd: SlashDef): void => {
    const next = `/${cmd.name} `;
    setInput(next);
    setCursor(next.length);
    setSuggestIdx(0);
    setHistoryIdx(null);
  };

  useInput((rawInput, key) => {
    // ctrl-c / ctrl-d are handled one level up (App).
    if (key.ctrl && (rawInput === "c" || rawInput === "d")) return;

    // Enter handling. See v0.14.24 landmine: Ink maps `\r` to
    // `key.return=true` and `\n` to `name="enter"` which isn't on the
    // `key` object, so we also scan the raw input for embedded
    // newlines to survive paste/pty batches.
    if (key.return) {
      // If the autocomplete is open with an exact-match highlight and
      // the user has typed nothing past the command name, submit as
      // the full `/command` rather than forcing them to Tab first.
      onSubmit(input);
      setCursor(0);
      setSuggestIdx(0);
      setHistoryIdx(null);
      return;
    }

    // Autocomplete: Tab completes.
    if (key.tab) {
      if (hasSuggestions) {
        const sel = visibleMatches[suggestIdx] ?? visibleMatches[0]!;
        applySuggestion(sel);
      }
      return;
    }

    // Up/Down: when autocomplete is open, navigate suggestions.
    // Otherwise cycle through the input-history ring.
    if (key.upArrow) {
      if (hasSuggestions) {
        setSuggestIdx((i) => Math.max(0, i - 1));
      } else if (commandHistory.length > 0) {
        if (historyIdx === null) {
          draftRef.current = input;
          const next = commandHistory.length - 1;
          setHistoryIdx(next);
          const v = commandHistory[next]!;
          setInput(v);
          setCursor(v.length);
        } else if (historyIdx > 0) {
          const next = historyIdx - 1;
          setHistoryIdx(next);
          const v = commandHistory[next]!;
          setInput(v);
          setCursor(v.length);
        }
      }
      return;
    }
    if (key.downArrow) {
      if (hasSuggestions) {
        setSuggestIdx((i) => Math.min(visibleMatches.length - 1, i + 1));
      } else if (historyIdx !== null) {
        const next = historyIdx + 1;
        if (next >= commandHistory.length) {
          setHistoryIdx(null);
          setInput(draftRef.current);
          setCursor(draftRef.current.length);
        } else {
          setHistoryIdx(next);
          const v = commandHistory[next]!;
          setInput(v);
          setCursor(v.length);
        }
      }
      return;
    }

    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(input.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const next = input.slice(0, cursor - 1) + input.slice(cursor);
        setInput(next);
        setCursor((c) => Math.max(0, c - 1));
        setHistoryIdx(null);
      }
      return;
    }
    if (key.escape) {
      if (hasSuggestions) {
        // Collapse the autocomplete: clear the `/` prefix so the
        // popover disappears while preserving what was typed after
        // the command name (rare, but let's be nice about it).
        if (input.startsWith("/")) {
          const afterSpace = input.indexOf(" ");
          const rest = afterSpace >= 0 ? input.slice(afterSpace + 1) : "";
          setInput(rest);
          setCursor(rest.length);
          setSuggestIdx(0);
        }
      }
      return;
    }
    if (!rawInput) return;

    // Strip bracketed-paste wrappers if the terminal sent them.
    const cleaned = rawInput.replace(/\x1b\[20[01]~/g, "");
    if (!cleaned) return;

    // Paste with embedded newline = submit everything before the
    // newline; drop the rest (avoids second-message injection).
    const nlIndex = cleaned.search(/[\r\n]/);
    if (nlIndex >= 0) {
      const before = cleaned.slice(0, nlIndex);
      const merged = input.slice(0, cursor) + before + input.slice(cursor);
      onSubmit(merged);
      setCursor(0);
      setSuggestIdx(0);
      setHistoryIdx(null);
      return;
    }

    const next = input.slice(0, cursor) + cleaned + input.slice(cursor);
    setInput(next);
    setCursor((c) => c + cleaned.length);
    setHistoryIdx(null);
  }, { isActive: active });

  // Render the value with an inverse-video block as a fake cursor.
  // While `thinking` is true, the box stays visible and accepts input,
  // but we swap the border color + placeholder text to signal that the
  // next submit will be queued rather than run immediately.
  const display = renderWithCursor(input, cursor, active, thinking);
  const borderColor = thinking ? "magenta" : "cyan";

  return (
    <Box flexDirection="column">
      {pendingAttachments.length > 0 && (
        <Box>
          <Text dimColor>
            📎 {pendingAttachments.length} attachment{pendingAttachments.length === 1 ? "" : "s"} queued
          </Text>
        </Box>
      )}
      <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={borderColor}>› </Text>
        <Text>{display}</Text>
      </Box>
      {hasSuggestions && (
        <SuggestionList matches={visibleMatches} selectedIdx={suggestIdx} total={matches.length} />
      )}
    </Box>
  );
}

interface SuggestionListProps {
  matches: SlashDef[];
  selectedIdx: number;
  total: number;
}

function SuggestionList({ matches, selectedIdx, total }: SuggestionListProps): React.ReactElement {
  // Pad command names to a consistent width so the hints align.
  const nameWidth = Math.max(...matches.map((m) => m.name.length)) + 1;
  return (
    <Box flexDirection="column" marginLeft={1} marginTop={0}>
      {matches.map((m, i) => {
        const selected = i === selectedIdx;
        const prefix = selected ? "▸ " : "  ";
        const padded = ("/" + m.name).padEnd(nameWidth + 1, " ");
        return (
          <Box key={m.name}>
            <Text color={selected ? "cyan" : undefined} dimColor={!selected}>
              {prefix}
            </Text>
            <Text color={selected ? "cyan" : undefined} bold={selected}>
              {padded}
            </Text>
            {m.args && (
              <Text dimColor>{m.args} </Text>
            )}
            <Text dimColor>{m.hint}</Text>
          </Box>
        );
      })}
      {total > matches.length && (
        <Text dimColor>  … {total - matches.length} more. keep typing to narrow.</Text>
      )}
      <Text dimColor>  ↑↓ select · Tab complete · Esc dismiss</Text>
    </Box>
  );
}

function renderWithCursor(value: string, cursor: number, active: boolean, thinking: boolean): string {
  if (!active) {
    return value || " ";
  }
  const INV = "\x1b[7m";
  const RST = "\x1b[27m";
  const DIM = "\x1b[2m";
  const DIM_OFF = "\x1b[22m";
  if (value.length === 0) {
    const placeholder = thinking
      ? "queue a message while the agent is thinking…"
      : "type a message, / for commands";
    return `${INV} ${RST}${DIM}${placeholder}${DIM_OFF}`;
  }
  if (cursor >= value.length) {
    return `${value}${INV} ${RST}`;
  }
  return `${value.slice(0, cursor)}${INV}${value[cursor]}${RST}${value.slice(cursor + 1)}`;
}

// ── Status bar ─────────────────────────────────────────────────────

interface StatusBarProps {
  cfg: AgentConfig;
  modelOverride: string | undefined;
  initialModel: string;
  initialEffort: string;
  stats: SessionStats;
  pendingAttachments: number;
  queueLength: number;
}

// Session-only status. The intro block already shows model/effort/ctx
// at mount; we only surface those again here when they've changed
// mid-session (via `/model` or `/effort`). Otherwise the line is pure
// running totals: turns, tokens, cost, attachment badge, queue depth.
function StatusBar({
  cfg,
  modelOverride,
  initialModel,
  initialEffort,
  stats,
  pendingAttachments,
  queueLength,
}: StatusBarProps): React.ReactElement {
  const currentModel = modelOverride ?? cfg.model;
  const modelChanged = currentModel !== initialModel;
  const effortChanged = cfg.effort !== initialEffort;
  const total = stats.inputTokens + stats.outputTokens;
  const bits: string[] = [];
  if (modelChanged) bits.push(`model: ${currentModel}`);
  if (effortChanged) bits.push(`effort: ${cfg.effort}`);
  bits.push(`${stats.turnCount} turn${stats.turnCount === 1 ? "" : "s"}`);
  bits.push(`${formatNum(total)} tok`);
  bits.push(`$${stats.costUsd.toFixed(4)}`);
  return (
    <Box>
      <Text dimColor>{" " + bits.join(" · ")}</Text>
      {pendingAttachments > 0 && (
        <Text color="cyan"> · 📎 {pendingAttachments}</Text>
      )}
      {queueLength > 0 && (
        <Text color="magenta"> · ⧗ {queueLength} queued</Text>
      )}
    </Box>
  );
}

// ── Hint footer ────────────────────────────────────────────────────

function HintFooter({ hasInput, isSlash, thinking }: { hasInput: boolean; isSlash: boolean; thinking: boolean }): React.ReactElement {
  // Change hints based on context so they actually feel useful rather
  // than being a static clutter line.
  let hint: string;
  if (isSlash) {
    hint = "↑↓ select · Tab complete · Enter submit · Esc dismiss";
  } else if (thinking) {
    hint = hasInput
      ? "Enter queues message · ←→ edit · Ctrl-D quit"
      : "type to queue while thinking · Ctrl-D quit";
  } else if (hasInput) {
    hint = "Enter send · ←→ edit · Ctrl-D quit";
  } else {
    hint = "↑↓ recall · / commands · Ctrl-D quit";
  }
  return (
    <Box>
      <Text dimColor>{" " + hint}</Text>
    </Box>
  );
}

// ── Slash commands ────────────────────────────────────────────────

interface SlashCtx {
  profile: string;
  cfg: AgentConfig;
  setCfg: (c: AgentConfig) => void;
  agentName: string;
  stats: SessionStats;
  pendingAttachments: string[];
  setPendingAttachments: (v: string[]) => void;
  getModel: () => string | undefined;
  setModel: (m: string | undefined) => void;
  appendSystem: (lines: { text: string; color?: string; dim?: boolean }[]) => void;
  exit: () => void;
}

async function handleSlash(input: string, ctx: SlashCtx): Promise<void> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "help":
    case "?":
      ctx.appendSystem(helpLines());
      return;
    case "exit":
    case "quit":
    case "q":
      ctx.exit();
      return;
    case "clear":
      ctx.appendSystem([{ text: "✓ session history cleared (memory DB untouched)", color: "green" }]);
      return;
    case "stats":
      ctx.appendSystem(detailedStatsLines(ctx));
      return;
    case "context":
    case "ctx": {
      const model = ctx.getModel() ?? ctx.cfg.model;
      const tier = tierFor(model === AUTO ? SONNET : model);
      if (!arg) {
        const current = ctx.cfg.contextWindow ?? "200k";
        const ctxTokens = current === "1m" ? CTX_TOKENS_1M : CTX_TOKENS_200K[tier];
        const budget = budgetFor(tier);
        ctx.appendSystem([
          { text: `context window:   ${formatNum(ctxTokens)} tokens (${current})` },
          { text: `per-cycle prompt: ${budget.memoryCount} memories · ${budget.skillCount} skills` },
          { text: "set with: /context 200k | /context 1m  (1m is a beta, API-key auth only)", dim: true },
        ]);
        return;
      }
      const target = arg.toLowerCase();
      if (target !== "200k" && target !== "1m") {
        ctx.appendSystem([{ text: "usage: /context 200k | 1m", color: "red" }]);
        return;
      }
      const next = { ...ctx.cfg, contextWindow: target as "200k" | "1m" };
      saveConfig(next);
      ctx.setCfg(next);
      if (target === "1m") {
        ctx.appendSystem([
          { text: "✓ context window set to 1M (beta)", color: "green" },
          { text: "  Requires API-key auth. Subscription users will get a warning + fallback to 200k.", dim: true },
        ]);
      } else {
        ctx.appendSystem([{ text: "✓ context window set to 200k", color: "green" }]);
      }
      return;
    }
    case "model": {
      if (!arg) {
        const current = ctx.getModel() ?? ctx.cfg.model;
        ctx.appendSystem([
          { text: `current: ${current}` },
          { text: "set with: /model auto | haiku | sonnet | opus | <full-id>", dim: true },
          { text: "session-only (doesn't touch config.json)", dim: true },
        ]);
        return;
      }
      const resolved = resolveModelAlias(arg);
      ctx.setModel(resolved);
      ctx.appendSystem([{ text: `✓ model for this session: ${resolved}`, color: "green" }]);
      return;
    }
    case "effort": {
      if (!arg) {
        ctx.appendSystem([
          { text: `current: ${ctx.cfg.effort}` },
          { text: "set with: /effort low | medium | high | xhigh | max", dim: true },
          { text: "higher = more runway (turns/tokens). max = unlimited-ish.", dim: true },
        ]);
        return;
      }
      const level = arg.toLowerCase();
      const allowed = ["low", "medium", "high", "xhigh", "max"];
      if (!allowed.includes(level)) {
        ctx.appendSystem([{ text: `must be one of: ${allowed.join(", ")}`, color: "red" }]);
        return;
      }
      const next = { ...ctx.cfg, effort: level as "low" | "medium" | "high" | "xhigh" | "max" };
      saveConfig(next);
      ctx.setCfg(next);
      ctx.appendSystem([{ text: `✓ effort set to ${level} (persisted to config.json)`, color: "green" }]);
      return;
    }
    case "image":
    case "img": {
      if (!arg) {
        if (ctx.pendingAttachments.length === 0) {
          ctx.appendSystem([{ text: "no images queued. usage: /image <path>", dim: true }]);
        } else {
          ctx.appendSystem([
            { text: `queued images (${ctx.pendingAttachments.length}):` },
            ...ctx.pendingAttachments.map((p) => ({ text: `  ${p}`, color: "cyan" })),
          ]);
        }
        return;
      }
      const p = arg.trim();
      if (!existsSync(p) || !statSync(p).isFile()) {
        ctx.appendSystem([{ text: `file not found: ${p}`, color: "red" }]);
        return;
      }
      ctx.setPendingAttachments([...ctx.pendingAttachments, p]);
      ctx.appendSystem([
        { text: `✓ image queued: ${p}`, color: "green" },
        { text: "  it will be attached to your next message", dim: true },
      ]);
      return;
    }
    case "video":
    case "vid": {
      if (!arg) {
        if (ctx.pendingAttachments.length === 0) {
          ctx.appendSystem([{ text: "no frames queued. usage: /video <path>", dim: true }]);
        } else {
          ctx.appendSystem([
            { text: `queued attachments (${ctx.pendingAttachments.length}):` },
            ...ctx.pendingAttachments.map((p) => ({ text: `  ${p}`, color: "cyan" })),
          ]);
        }
        return;
      }
      const p = arg.trim();
      if (!existsSync(p) || !statSync(p).isFile()) {
        ctx.appendSystem([{ text: `file not found: ${p}`, color: "red" }]);
        return;
      }
      ctx.appendSystem([{ text: "extracting frames...", dim: true }]);
      const frames = extractFrames(p);
      if (frames.length === 0) {
        ctx.appendSystem([{ text: "frame extraction failed - is ffmpeg installed?", color: "red" }]);
        return;
      }
      ctx.setPendingAttachments([...ctx.pendingAttachments, ...frames]);
      ctx.appendSystem([
        { text: `✓ ${frames.length} frames queued from ${p}`, color: "green" },
        { text: "  they will be attached to your next message", dim: true },
      ]);
      return;
    }
    case "compact": {
      const { compact, shouldCompact } = await import("../memory/compact.js");
      const db = openDb(ctx.profile);
      try {
        const decision = shouldCompact(db, ctx.cfg.compaction);
        if (!decision.yes) {
          ctx.appendSystem([{ text: `no trigger - ${decision.reason}. Running anyway (--force).`, dim: true }]);
        }
        ctx.appendSystem([{ text: "compacting…", color: "cyan" }]);
        const r = await compact(db, ctx.cfg.compaction);
        ctx.appendSystem([
          { text: `✓ compacted: ${r.memoriesBefore} → ${r.memoriesAfter} memories · ${r.cyclesPruned} cycles pruned · ${r.durationMs}ms`, color: "green" },
        ]);
      } finally {
        db.close();
      }
      return;
    }
    case "history":
      ctx.appendSystem([{ text: "(use the dashboard for full history — /stats for session totals)", dim: true }]);
      return;
    default:
      ctx.appendSystem([
        { text: `unknown command: /${cmd}`, color: "red" },
        { text: "type /help for the list", dim: true },
      ]);
  }
}

function helpLines(): { text: string; color?: string; dim?: boolean }[] {
  return [
    { text: "commands:", color: "white" },
    { text: "  /help                 this list", color: "cyan" },
    { text: "  /exit · /quit · /q    end the session (or Ctrl-D)", color: "cyan" },
    { text: "  /clear                clear session history (DB memory untouched)", color: "cyan" },
    { text: "  /stats                session totals, 5h/weekly usage", color: "cyan" },
    { text: "  /context · /ctx       show or set context window (200k | 1m)", color: "cyan" },
    { text: "  /model [id|alias]     show or set session model (auto · haiku · sonnet · opus)", color: "cyan" },
    { text: "  /effort [low|medium|high|xhigh|max]   show or set effort", color: "cyan" },
    { text: "  /compact              run memory compaction now", color: "cyan" },
    { text: "  /image <path>         queue an image for your next message", color: "cyan" },
    { text: "  /video <path>         extract frames from a video and queue them", color: "cyan" },
  ];
}

function detailedStatsLines(ctx: SlashCtx): { text: string; color?: string; dim?: boolean }[] {
  const elapsedSec = Math.round((Date.now() - ctx.stats.started) / 1000);
  const db = openDb(ctx.profile);
  let fiveH: UsageWindow, day: UsageWindow, week: UsageWindow;
  try {
    fiveH = usageWindow(db, 5);
    day = usageWindow(db, 24);
    week = usageWindow(db, 24 * 7);
  } finally {
    db.close();
  }
  return [
    { text: "this session" },
    { text: `  turns:     ${ctx.stats.turnCount}` },
    { text: `  tokens:    ${formatNum(ctx.stats.inputTokens)} in · ${formatNum(ctx.stats.outputTokens)} out` },
    { text: `  cost:      $${ctx.stats.costUsd.toFixed(4)}` },
    { text: `  elapsed:   ${elapsedSec}s` },
    { text: "" },
    { text: "profile usage (from cycle log)" },
    { text: `  last 5h:   ${formatWindow(fiveH)}` },
    { text: `  last 24h:  ${formatWindow(day)}` },
    { text: `  last 7d:   ${formatWindow(week)}` },
    { text: "(counts include heartbeats + other sessions, not just this chat)", dim: true },
  ];
}

// ── Helpers ────────────────────────────────────────────────────────

function nextId(ref: React.MutableRefObject<number>): number {
  ref.current += 1;
  return ref.current;
}

function usageWindow(db: DB, hours: number): UsageWindow {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS cycles,
      COALESCE(SUM(input_tokens), 0) AS in_tokens,
      COALESCE(SUM(output_tokens), 0) AS out_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM cycles
    WHERE started_at > ? AND status = 'ok'
  `).get(since) as { cycles: number; in_tokens: number; out_tokens: number; cost: number };
  return {
    cycles: Number(row.cycles),
    inputTokens: Number(row.in_tokens),
    outputTokens: Number(row.out_tokens),
    costUsd: Number(row.cost),
  };
}

function formatWindow(w: UsageWindow): string {
  const total = w.inputTokens + w.outputTokens;
  return `${w.cycles} cycles · ${formatNum(total)} tok · $${w.costUsd.toFixed(4)}`;
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function shortModel(full: string): string {
  if (full.includes("haiku")) return "haiku";
  if (full.includes("sonnet")) return "sonnet";
  if (full.includes("opus")) return "opus";
  return full;
}

function resolveModelAlias(v: string): string {
  const lower = v.toLowerCase();
  if (lower in MODEL_ALIAS) return MODEL_ALIAS[lower]!;
  return v;
}

function buildStatusLine(r: CycleOutput, cfg: AgentConfig): string {
  const bits: string[] = [];
  if (r.model) bits.push(shortModel(r.model));
  bits.push(cfg.effort);
  if (r.inputTokens != null || r.outputTokens != null) {
    bits.push(`${formatNum(r.inputTokens ?? 0)} in / ${formatNum(r.outputTokens ?? 0)} out`);
  }
  bits.push(`${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.costUsd != null) bits.push(`$${r.costUsd.toFixed(4)}`);
  bits.push(`#${r.cycleId}`);
  return bits.join(" · ");
}

function formatCycleError(r: CycleOutput | null): string {
  if (!r) return "no response from backend";
  const raw = (r.error ?? "").trim();
  if (!raw) return "backend returned no output";

  const maxTurnsMatch = raw.match(/^max_turns_hit:(\d+|\?)/);
  if (maxTurnsMatch) {
    const used = maxTurnsMatch[1];
    return `ran out of turns (${used} used this cycle). Try breaking the task up or retrying.`;
  }
  if (/permission|needs write/i.test(raw)) {
    return "backend needed tool approval. Update: npm install -g bajaclaw@latest";
  }
  if (/rate[- ]?limit/i.test(raw)) {
    return "rate-limited by Anthropic. Wait a few minutes and retry.";
  }
  if (/credit|quota|billing/i.test(raw)) {
    return `${raw} - check your Anthropic plan.`;
  }
  if (/^exit \d+$/i.test(raw)) {
    return `backend exited (${raw}) with no detail. Check: bajaclaw daemon logs`;
  }
  return raw.split("\n")[0]!.slice(0, 400);
}

function extractFrames(videoPath: string, frameCount = 8): string[] {
  let interval = 2;
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath,
  ], { encoding: "utf8" });
  if (probe.status === 0) {
    const dur = parseFloat(probe.stdout.trim());
    if (dur > 0) interval = Math.max(0.5, dur / frameCount);
  }
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pattern = join(tmpdir(), `bajaclaw-video-${ts}-frame-%03d.jpg`);
  spawnSync("ffmpeg", [
    "-i", videoPath,
    "-vf", `fps=1/${interval.toFixed(2)}`,
    "-frames:v", String(frameCount),
    pattern,
  ]);
  const frames: string[] = [];
  for (let i = 1; i <= frameCount; i++) {
    const fp = pattern.replace("%03d", String(i).padStart(3, "0"));
    try { if (statSync(fp).isFile()) frames.push(fp); } catch { /* skip */ }
  }
  return frames;
}

function printSessionSummary(
  stdout: NodeJS.WriteStream,
  stats: SessionStats,
): void {
  if (stats.turnCount === 0) {
    stdout.write("\nbye.\n");
    return;
  }
  const elapsedSec = Math.round((Date.now() - stats.started) / 1000);
  const dur = elapsedSec > 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
  stdout.write(
    `\nSession: ${stats.turnCount} turns · ${formatNum(stats.inputTokens + stats.outputTokens)} tokens · $${stats.costUsd.toFixed(4)} · ${dur}\n\n`,
  );
}
