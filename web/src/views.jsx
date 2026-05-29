import { useRef, useState, useEffect, useCallback } from "react";
import { streamChat } from "./gateway.js";
import { api } from "./api.js";

/* ---------- shared bits ---------- */
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
function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => setState({ loading: false, data, error: null }))
        .catch((e) => setState({ loading: false, data: null, error: e.message }));
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
function Loading({ error }) {
  if (error) return <div className="banner banner--warn">Couldn't reach the gateway: {error}. Is the daemon running?</div>;
  return <p className="muted">Loading…</p>;
}

/* ---------- Chat (streams from the local endpoint; agent or raw) ---------- */
export function ChatView() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "BajaClaw is ready. Ask me anything, or describe an outcome and I'll run it as a Cowork task." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(false);
  const [err, setErr] = useState(null);
  const scroller = useRef(null);

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, busy]);

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
      for await (const delta of streamChat(next, { model: raw ? "bajaclaw-raw" : "bajaclaw" })) {
        acc += delta;
        setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: "assistant", content: acc }; return c; });
      }
    } catch {
      setErr("Local API not reachable. Start it with `bajaclaw start`.");
      setMessages((m) => m.slice(0, -1));
    } finally { setBusy(false); }
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
        <label className="toggle" title="Raw bypasses memory, system prompt, and tools">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
          placeholder="Message BajaClaw…  (Enter to send, Shift+Enter for newline)"
          rows={1} aria-label="Message"
        />
        <button className="btn btn--primary" disabled={busy || !input.trim()}>{busy ? "Working…" : "Send"}</button>
      </form>
    </div>
  );
}

/* ---------- Cowork (runs a goal through the agent) ---------- */
export function CoworkView() {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  async function run() {
    if (!goal.trim() || busy) return;
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await api.cowork(goal.trim())); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="lede">Describe an outcome. BajaClaw plans it, works the steps through your model, and returns a deliverable.</p>
      <div className="card">
        <label className="field-k" htmlFor="goal">Goal</label>
        <input id="goal" className="input" value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Draft a 5-point launch checklist for a new feature"
          onKeyDown={(e) => e.key === "Enter" && run()} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" onClick={run} disabled={busy || !goal.trim()}>{busy ? "Working…" : "Run outcome"}</button>
          <span className="muted">understand → gather → produce → verify</span>
        </div>
      </div>
      {err && <div className="banner banner--warn">{err}</div>}
      {result && (
        <div className="card">
          <div className="field-k" style={{ marginBottom: 8 }}>Result · {result.status}</div>
          {result.results?.map((r, i) => (
            <div key={i} className="step">
              <span className="step-title">{r.step.title}</span>
              <span className="step-note">{r.result?.note}</span>
            </div>
          ))}
        </div>
      )}
      {!result && !busy && <Empty title="No tasks yet">Run an outcome above. Steps and the final deliverable show here.</Empty>}
    </div>
  );
}

/* ---------- Activity (live SSE events) ---------- */
export function ActivityView({ events = [] }) {
  if (!events.length) return <Empty title="Listening">Live agent and channel events stream here as they happen.</Empty>;
  return (
    <div className="stack">
      <p className="lede">Live events from the gateway.</p>
      <ul className="list">
        {events.slice().reverse().map((e, i) => (
          <li key={i} className="list-row">
            <span><Pill tone="teal">{e.type}</Pill> <span className="muted">{e.channel || e.phase || ""}</span> {e.text || e.step || ""}</span>
            <span className="mono muted">{(e.at || "").slice(11, 19)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Sessions (recent remembered outcomes) ---------- */
export function SessionsView() {
  const { data, loading, error } = useAsync(() => api.memory(), []);
  if (loading || error) return <Loading error={error} />;
  const items = data.items || [];
  if (!items.length) return <Empty title="No history yet">As you chat and run tasks, recent outcomes appear here.</Empty>;
  return (
    <div className="stack">
      <p className="lede">Recent outcomes BajaClaw has worked on.</p>
      <ul className="list">
        {items.map((m) => (
          <li key={m.id} className="list-row">
            <span>{m.task}</span>
            <span className="mono muted">{(m.at || "").slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Channels (toggle + token, applied live) ---------- */
export function ChannelsView() {
  const { data, loading, error, reload } = useAsync(() => api.channels(), []);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  if (loading || error) return <Loading error={error} />;

  async function save(id, patch) {
    setSaving(id);
    try { await api.setChannel(id, patch); await reload(); setDrafts((d) => ({ ...d, [id]: "" })); }
    finally { setSaving(null); }
  }

  return (
    <div className="stack">
      <p className="lede">Reach BajaClaw from a messaging app. Telegram and Discord are native; add a bot token and enable.</p>
      <div className="provider-grid">
        {data.channels.map((c) => (
          <div key={c.id} className={`provider ${c.enabled ? "is-active" : ""}`}>
            <div className="provider-top">
              <span className="provider-name">{c.id}</span>
              <Pill tone={c.native ? "teal" : "neutral"}>{c.native ? "native" : "scaffold"}</Pill>
            </div>
            <span className="provider-note">{c.hasToken ? "token set" : "no token"} · {c.enabled ? "enabled" : "disabled"}</span>
            {c.id !== "imessage" && (
              <input className="input" type="password" placeholder={c.hasToken ? "replace token" : "bot token"}
                value={drafts[c.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} />
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" disabled={saving === c.id}
                onClick={() => save(c.id, { enabled: !c.enabled, ...(drafts[c.id] ? { token: drafts[c.id] } : {}) })}>
                {c.enabled ? "Disable" : "Enable"}
              </button>
              {drafts[c.id] && (
                <button className="btn btn--primary" disabled={saving === c.id}
                  onClick={() => save(c.id, { token: drafts[c.id] })}>Save token</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Schedules ---------- */
export function CronView() {
  const { data, loading, error } = useAsync(() => api.getConfig(), []);
  if (loading || error) return <Loading error={error} />;
  const su = data.selfUpdate || {};
  return (
    <div className="stack">
      <ul className="list">
        <li className="list-row">
          <span>Daily self-update check</span>
          <Pill tone={su.enabled ? "teal" : "neutral"}>{su.enabled ? `every ${su.intervalHours}h · ${su.mode}` : "disabled"}</Pill>
        </li>
      </ul>
      <Empty title="Built-in schedule">The self-updater runs daily. Custom cron jobs are coming; for now this is the active schedule.</Empty>
    </div>
  );
}

/* ---------- Skills ---------- */
export function SkillsView() {
  const { data, loading, error } = useAsync(() => api.skills(), []);
  if (loading || error) return <Loading error={error} />;
  const skills = data.skills || [];
  return (
    <div className="stack">
      <p className="lede">Skills BajaClaw synthesized from repeated successful tasks.</p>
      {skills.length ? (
        <ul className="list">
          {skills.map((s) => (
            <li key={s.name} className="list-row">
              <span><strong>{s.name}</strong> <span className="muted">{s.summary}</span></span>
              <Pill tone="amber">{s.from}x</Pill>
            </li>
          ))}
        </ul>
      ) : <Empty title="Learning">Repeat a kind of task a few times and BajaClaw proposes a reusable skill here.</Empty>}
    </div>
  );
}

/* ---------- Memory (search + clear) ---------- */
export function MemoryView() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.memory(q), [q]);
  const [clearing, setClearing] = useState(false);

  async function clearAll() {
    if (!confirm("Clear all memory? This cannot be undone.")) return;
    setClearing(true);
    try { await api.clearMemory(); await reload(); } finally { setClearing(false); }
  }

  return (
    <div className="stack">
      <p className="lede">Long-term memory of task outcomes, recalled automatically during work.</p>
      <div className="row">
        <input className="input" placeholder="Search memory…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={clearAll} disabled={clearing}>Clear all</button>
      </div>
      {loading || error ? <Loading error={error} /> : (
        (data.items || []).length ? (
          <ul className="list">
            {data.items.map((m) => (
              <li key={m.id} className="list-row">
                <span>{m.task} <span className="muted">{m.outcome}</span></span>
                <Pill tone={m.success ? "teal" : "neutral"}>{(m.tags || [])[1] || (m.tags || [])[0] || "memory"}</Pill>
              </li>
            ))}
          </ul>
        ) : <Empty title="Memory is empty">Outcomes you produce get remembered and recalled later.</Empty>
      )}
    </div>
  );
}

/* ---------- Models & login ---------- */
export function ProvidersView() {
  const { data, loading, error, reload } = useAsync(() => api.providers(), []);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  if (loading || error) return <Loading error={error} />;

  async function act(fn, id) { setBusy(id); try { await fn(); await reload(); } finally { setBusy(null); } }

  return (
    <div className="stack">
      <p className="lede">ChatGPT is the default. Every other provider stays available with automatic fallback.</p>
      <div className="provider-grid">
        {data.providers.map((p) => (
          <div key={p.id} className={`provider ${p.isDefault ? "is-active" : ""}`}>
            <div className="provider-top">
              <span className="provider-name">{p.label}</span>
              {p.isDefault ? <Pill tone="amber">default</Pill> : p.configured ? <Pill tone="teal">ready</Pill> : <Pill tone="neutral">not set</Pill>}
            </div>
            {p.kind === "oauth" && (
              <span className="provider-note">{p.configured ? "signed in" : "run "}<code className="mono">bajaclaw onboard</code>{p.configured ? "" : " to sign in"}</span>
            )}
            {p.kind === "local" && <span className="provider-note">local server, no key needed</span>}
            {p.kind !== "oauth" && p.kind !== "local" && (
              <input className="input" type="password" placeholder={p.configured ? "replace API key" : "API key"}
                value={drafts[p.id] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} />
            )}
            <div className="row" style={{ marginTop: 8 }}>
              {!p.isDefault && p.configured && (
                <button className="btn" disabled={busy === p.id} onClick={() => act(() => api.setDefaultProvider(p.id), p.id)}>Make default</button>
              )}
              {drafts[p.id] && (
                <button className="btn btn--primary" disabled={busy === p.id}
                  onClick={() => act(async () => { await api.setProviderKey(p.id, drafts[p.id]); setDrafts((d) => ({ ...d, [p.id]: "" })); }, p.id)}>Save key</button>
              )}
              {p.configured && p.kind !== "local" && (
                <button className="btn" disabled={busy === p.id} onClick={() => act(() => api.removeProvider(p.id), p.id)}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">Logins stay on your machine, single-user. Nothing is pooled or shared.</p>
    </div>
  );
}

/* ---------- Local API (status + mode toggle) ---------- */
export function EndpointView({ endpoints }) {
  const { data, loading, error, reload } = useAsync(() => api.getConfig(), []);
  const base = endpoints?.OPENAI_BASE || "http://127.0.0.1:11435";
  const [busy, setBusy] = useState(false);
  if (loading || error) return <Loading error={error} />;
  const ep = data.openaiEndpoint || {};
  const curl = `curl ${base}/v1/chat/completions \\\n  -H "content-type: application/json" \\\n  -d '{"model":"bajaclaw","messages":[{"role":"user","content":"hi"}]}'`;

  async function setMode(mode) { setBusy(true); try { await api.patchConfig({ openaiEndpoint: { mode } }); await reload(); } finally { setBusy(false); } }

  return (
    <div className="stack">
      <p className="lede">Point any OpenAI client at BajaClaw to use it as a local LLM.</p>
      <div className="card">
        <Field label="Base URL" value={`${base}/v1`} mono />
        <Field label="Models" value="bajaclaw · bajaclaw-chatgpt · bajaclaw-fast · bajaclaw-raw" mono />
        <Field label="Routes" value="/v1/chat/completions · /v1/models · /health" mono />
        <div className="field">
          <span className="field-k">Default mode</span>
          <span className="seg">
            <button className={`seg-btn ${ep.mode === "agent" ? "is-on" : ""}`} disabled={busy} onClick={() => setMode("agent")}>agent</button>
            <button className={`seg-btn ${ep.mode === "raw" ? "is-on" : ""}`} disabled={busy} onClick={() => setMode("raw")}>raw</button>
          </span>
        </div>
      </div>
      <div className="card">
        <div className="field-k" style={{ marginBottom: 8 }}>Try it</div>
        <pre className="code">{curl}</pre>
      </div>
      <p className="muted">agent adds memory + system prompt; raw is a bare passthrough. The <code className="mono">bajaclaw-raw</code> model is always raw.</p>
    </div>
  );
}

/* ---------- Updates ---------- */
export function UpdatesView() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const { data } = useAsync(() => api.getConfig(), []);
  async function check() { setBusy(true); try { setResult(await api.checkUpdates()); } finally { setBusy(false); } }
  const su = data?.selfUpdate || {};
  return (
    <div className="stack">
      <p className="lede">BajaClaw watches its inspirations (OpenClaw, Hermes, Cowork) and proposes upgrades. Nothing merges without your approval.</p>
      <div className="card">
        <Field label="Mode" value={`${su.mode || "propose"} · approve to merge`} />
        <Field label="Cadence" value={su.enabled ? `every ${su.intervalHours}h` : "disabled"} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" onClick={check} disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
        </div>
      </div>
      {result && (result.findings?.length ? (
        <div className="stack">
          {result.findings.map((f, i) => (
            <div key={i} className="card">
              <div className="provider-top"><span className="provider-name">{f.label}</span><Pill tone="amber">{f.to}</Pill></div>
              <span className="provider-note">{f.from} → {f.to}</span>
            </div>
          ))}
          {result.proposalPath && <p className="muted">Proposal written to <code className="mono">{result.proposalPath}</code></p>}
        </div>
      ) : <Empty title="Up to date">No upstream changes since the last check.</Empty>)}
    </div>
  );
}

/* ---------- Settings (live config edits) ---------- */
export function SettingsView({ endpoints }) {
  const { data, loading, error, reload } = useAsync(() => api.getConfig(), []);
  const [busy, setBusy] = useState(false);
  if (loading || error) return <Loading error={error} />;
  const strip = (u, d) => (u || d).replace(/^https?:\/\//, "");
  const f = data.features || {};

  async function patch(body) { setBusy(true); try { await api.patchConfig(body); await reload(); } finally { setBusy(false); } }
  const Toggle = ({ on, onClick, label }) => (
    <div className="field">
      <span className="field-k">{label}</span>
      <button className={`switch ${on ? "is-on" : ""}`} disabled={busy} onClick={onClick} aria-pressed={on}><i /></button>
    </div>
  );

  return (
    <div className="stack">
      <div className="card">
        <Field label="Config" value="~/.bajaclaw/config.json" mono />
        <Field label="Gateway" value={strip(endpoints?.GATEWAY_BASE, "http://127.0.0.1:18789")} mono />
        <Field label="Local API" value={strip(endpoints?.OPENAI_BASE, "http://127.0.0.1:11435")} mono />
        <Field label="Daemon" value="com.bajaclaw.gateway (launchd)" mono />
      </div>
      <div className="card">
        <div className="field-k" style={{ marginBottom: 6 }}>Features</div>
        <Toggle label="Hermes brain (memory + skills)" on={f.hermesBrain} onClick={() => patch({ features: { hermesBrain: !f.hermesBrain } })} />
        <Toggle label="Cowork outcome mode" on={f.coworkMode} onClick={() => patch({ features: { coworkMode: !f.coworkMode } })} />
        <Toggle label="Local OpenAI endpoint" on={data.openaiEndpoint?.enabled} onClick={() => patch({ openaiEndpoint: { enabled: !data.openaiEndpoint?.enabled } })} />
        <Toggle label="Daily self-update" on={data.selfUpdate?.enabled} onClick={() => patch({ selfUpdate: { enabled: !data.selfUpdate?.enabled } })} />
      </div>
      <p className="muted">Changes save immediately. Port changes need <code className="mono">bajaclaw restart</code>.</p>
    </div>
  );
}
