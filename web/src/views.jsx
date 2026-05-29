import { useRef, useState, useEffect } from "react";
import { streamChat } from "./gateway.js";

/* shared bits */
function Empty({ title, children }) {
  return (
    <div className="empty">
      <span className="empty-wave" aria-hidden>≈</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({ label, value, mono }) {
  return (
    <div className="field">
      <span className="field-k">{label}</span>
      <span className={`field-v ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}
function Pill({ tone = "neutral", children }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

/* ---------- Chat (real: talks to the local OpenAI endpoint) ---------- */
export function ChatView() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "BajaClaw is ready. Ask me anything, or describe an outcome and I'll run it as a Cowork task." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const scroller = useRef(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    const next = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      let acc = "";
      for await (const delta of streamChat(next)) {
        acc += delta;
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e2) {
      setErr("Local API not reachable. Start it with `bajaclaw start`.");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-thread">
          {messages.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>
              <div className="msg-role">{m.role === "user" ? "You" : "BajaClaw"}</div>
              <div className="msg-body">{m.content || <span className="caret" />}</div>
            </div>
          ))}
        </div>
      </div>
      {err && <div className="banner banner--warn">{err}</div>}
      <form className="composer" onSubmit={send}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
          placeholder="Message BajaClaw…  (Enter to send, Shift+Enter for newline)"
          rows={1}
          aria-label="Message"
        />
        <button className="btn btn--primary" disabled={busy || !input.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </div>
  );
}

/* ---------- Cowork ---------- */
export function CoworkView() {
  return (
    <div className="stack">
      <p className="lede">Describe an outcome. BajaClaw plans it, works across your tools and files, and returns a finished deliverable.</p>
      <div className="card">
        <label className="field-k" htmlFor="goal">Goal</label>
        <input id="goal" className="input" placeholder="e.g. Organize my ~/Downloads and write a summary of what changed" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--primary">Run outcome</button>
          <span className="muted">Steps: understand → gather → produce → verify</span>
        </div>
      </div>
      <Empty title="No tasks yet">Run an outcome above. Progress and the final deliverable show here.</Empty>
    </div>
  );
}

/* ---------- Activity / Sessions / Channels / Cron / Skills / Memory ---------- */
export function ActivityView({ gwState }) {
  return gwState === "connected"
    ? <Empty title="Listening">Live agent events stream here as they happen.</Empty>
    : <Empty title="Gateway offline">Run <code className="mono">bajaclaw start</code> to stream live activity.</Empty>;
}
export function SessionsView() {
  return <Empty title="No active sessions">Conversations across channels appear here once the gateway is running.</Empty>;
}
export function ChannelsView() {
  const ch = ["Telegram", "Slack", "Discord", "WhatsApp", "Signal", "iMessage", "Email"];
  return (
    <div className="stack">
      <p className="lede">Reach BajaClaw on the channels you already use. Connect them in onboarding or here.</p>
      <ul className="list">
        {ch.map((c) => (
          <li key={c} className="list-row">
            <span>{c}</span><Pill tone="neutral">not connected</Pill>
          </li>
        ))}
      </ul>
      <p className="muted">Channels are provided by OpenClaw extensions and configured via the gateway.</p>
    </div>
  );
}
export function CronView() {
  return (
    <div className="stack">
      <ul className="list">
        <li className="list-row">
          <span>Daily self-update check</span>
          <Pill tone="teal">every 24h · propose</Pill>
        </li>
      </ul>
      <Empty title="Add a schedule">Cron jobs run agent tasks on a timer. The self-updater is built in.</Empty>
    </div>
  );
}
export function SkillsView() {
  return (
    <div className="stack">
      <p className="lede">Skills are capabilities BajaClaw can use and create. The Hermes brain proposes new skills from repeated successes.</p>
      <Empty title="Learning">As tasks succeed, synthesized skills (auto-*) will appear here for review.</Empty>
    </div>
  );
}
export function MemoryView() {
  return (
    <div className="stack">
      <p className="lede">Long-term memory of task outcomes. Relevant memories are recalled automatically during work.</p>
      <Empty title="Memory is empty">Outcomes you and BajaClaw produce get remembered here and recalled later.</Empty>
    </div>
  );
}

/* ---------- Models & login (all providers, ChatGPT default) ---------- */
const PROVIDERS = [
  { id: "openai-codex", label: "ChatGPT", note: "Sign in with your subscription", tag: "default", tone: "amber" },
  { id: "anthropic", label: "Anthropic / Claude", note: "API key or Claude CLI login" },
  { id: "google", label: "Google Gemini", note: "API key" },
  { id: "openrouter", label: "OpenRouter", note: "One key, 200+ models" },
  { id: "openai", label: "OpenAI API", note: "Metered API key" },
  { id: "ollama", label: "Ollama", note: "Local models, no key" },
  { id: "lmstudio", label: "LM Studio", note: "Local, OpenAI-compatible" },
  { id: "groq", label: "Groq", note: "API key" },
  { id: "deepseek", label: "DeepSeek", note: "API key" },
];
export function ProvidersView() {
  const [active, setActive] = useState("openai-codex");
  return (
    <div className="stack">
      <p className="lede">ChatGPT is the default. Every other provider stays available, with automatic fallback if one is rate-limited.</p>
      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`provider ${active === p.id ? "is-active" : ""}`}
            onClick={() => setActive(p.id)}
            aria-pressed={active === p.id}
          >
            <div className="provider-top">
              <span className="provider-name">{p.label}</span>
              {p.tag && <Pill tone={p.tone || "teal"}>{p.tag}</Pill>}
            </div>
            <span className="provider-note">{p.note}</span>
            {active === p.id && <span className="provider-active mono">selected</span>}
          </button>
        ))}
      </div>
      <p className="muted">Logins are handled by the gateway. Your account stays on your machine, single-user.</p>
    </div>
  );
}

/* ---------- Local API endpoint ---------- */
export function EndpointView({ endpoints }) {
  const base = endpoints?.OPENAI_BASE || "http://127.0.0.1:11435";
  const curl = `curl ${base}/v1/chat/completions \\\n  -H "content-type: application/json" \\\n  -d '{"model":"bajaclaw","messages":[{"role":"user","content":"hi"}]}'`;
  return (
    <div className="stack">
      <p className="lede">Point any OpenAI client at BajaClaw to use it as a local LLM.</p>
      <div className="card">
        <Field label="Base URL" value={`${base}/v1`} mono />
        <Field label="Models" value="bajaclaw · bajaclaw-chatgpt · bajaclaw-fast" mono />
        <Field label="Routes" value="/v1/chat/completions · /v1/models · /health" mono />
        <Field label="Bind" value="localhost only (personal use)" />
      </div>
      <div className="card">
        <div className="field-k" style={{ marginBottom: 8 }}>Try it</div>
        <pre className="code">{curl}</pre>
      </div>
    </div>
  );
}

/* ---------- Updates ---------- */
export function UpdatesView() {
  return (
    <div className="stack">
      <p className="lede">BajaClaw watches its inspirations (OpenClaw, Hermes, Cowork) daily and writes proposals. Nothing is merged without your approval.</p>
      <div className="card">
        <Field label="Watching" value="openclaw/openclaw · NousResearch/hermes-agent · Claude Cowork" mono />
        <Field label="Mode" value="propose · approve to merge" />
        <Field label="Cadence" value="every 24 hours" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn">Check now</button>
          <span className="muted">or run <code className="mono">bajaclaw update</code></span>
        </div>
      </div>
      <Empty title="No pending proposals">When an upstream ships something worth taking, the diff and a one-click apply show here.</Empty>
    </div>
  );
}

/* ---------- Settings ---------- */
export function SettingsView() {
  return (
    <div className="stack">
      <div className="card">
        <Field label="Config" value="~/.bajaclaw/config.json" mono />
        <Field label="Gateway" value="127.0.0.1:18789" mono />
        <Field label="Local API" value="127.0.0.1:11435" mono />
        <Field label="Daemon" value="com.bajaclaw.gateway (launchd)" mono />
      </div>
      <p className="muted">After a reboot, run <code className="mono">bajaclaw start</code> to bring everything back up.</p>
    </div>
  );
}
