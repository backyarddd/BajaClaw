import { useEffect, useMemo, useState } from "react";
import { Wordmark } from "./Brand.jsx";
import { connectGateway, endpointHealth, ENDPOINTS } from "./gateway.js";
import {
  ChatView, SessionsView, ActivityView, ChannelsView, CronView, SkillsView,
  MemoryView, CoworkView, ProvidersView, EndpointView, UpdatesView, SettingsView,
} from "./views.jsx";

const NAV = [
  { id: "chat", label: "Chat", group: "main" },
  { id: "cowork", label: "Cowork tasks", group: "main" },
  { id: "activity", label: "Activity", group: "main" },
  { id: "sessions", label: "Sessions", group: "work" },
  { id: "channels", label: "Channels", group: "work" },
  { id: "cron", label: "Schedules", group: "work" },
  { id: "skills", label: "Skills", group: "work" },
  { id: "memory", label: "Memory", group: "work" },
  { id: "providers", label: "Models & login", group: "system" },
  { id: "endpoint", label: "Local API", group: "system" },
  { id: "updates", label: "Updates", group: "system" },
  { id: "settings", label: "Settings", group: "system" },
];
const GROUPS = [
  { id: "main", label: "" },
  { id: "work", label: "Workspace" },
  { id: "system", label: "System" },
];

function StatusDot({ state, label }) {
  return (
    <span className={`statusdot statusdot--${state}`} title={`${label}: ${state}`}>
      <i /> <span className="statusdot-label">{label}</span>
    </span>
  );
}

export default function App() {
  const [route, setRoute] = useState("chat");
  const [gwState, setGwState] = useState("connecting");
  const [epUp, setEpUp] = useState(null);

  useEffect(() => {
    const conn = connectGateway({ onStatus: (s) => s.gateway && setGwState(s.gateway) });
    const t = setTimeout(() => setGwState((p) => (p === "connecting" ? "offline" : p)), 1500);
    let active = true;
    endpointHealth().then((ok) => active && setEpUp(ok));
    const poll = setInterval(() => endpointHealth().then((ok) => active && setEpUp(ok)), 8000);
    return () => { active = false; clearTimeout(t); clearInterval(poll); conn.close(); };
  }, []);

  const View = useMemo(() => ({
    chat: ChatView, sessions: SessionsView, activity: ActivityView, channels: ChannelsView,
    cron: CronView, skills: SkillsView, memory: MemoryView, cowork: CoworkView,
    providers: ProvidersView, endpoint: EndpointView, updates: UpdatesView, settings: SettingsView,
  }[route] || ChatView), [route]);

  const epState = epUp == null ? "connecting" : epUp ? "ok" : "offline";

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand"><Wordmark /></div>
        <nav className="rail-nav" aria-label="Primary">
          {GROUPS.map((g) => (
            <div key={g.id} className="rail-group">
              {g.label && <div className="rail-group-label">{g.label}</div>}
              {NAV.filter((n) => n.group === g.id).map((n) => (
                <button
                  key={n.id}
                  className={`rail-item ${route === n.id ? "is-active" : ""}`}
                  aria-current={route === n.id ? "page" : undefined}
                  onClick={() => setRoute(n.id)}
                >
                  <span className="rail-item-wave" aria-hidden>≈</span>
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="mono">v1.0.0</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">{NAV.find((n) => n.id === route)?.label}</div>
          <div className="topbar-status">
            <StatusDot state={gwState === "connected" ? "ok" : gwState} label="gateway" />
            <StatusDot state={epState} label="local API" />
          </div>
        </header>
        <section className="content" key={route}>
          <View gwState={gwState} endpoints={ENDPOINTS} />
        </section>
      </main>
    </div>
  );
}
