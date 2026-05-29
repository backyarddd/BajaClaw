// Native channel manager. No OpenClaw. Starts each enabled channel and wires
// inbound messages to BajaClaw's agent, then sends the reply back.
import { load } from "../src/config/config.mjs";
import { respond } from "../src/agent/agent.mjs";
import { publish } from "../src/daemon/gateway.mjs";

// id -> dynamic import path
const CHANNELS = {
  telegram: () => import("./telegram.mjs"),
  discord: () => import("./discord.mjs"),
  slack: () => import("./scaffold.mjs"),
  whatsapp: () => import("./scaffold.mjs"),
  imessage: () => import("./scaffold.mjs"),
};

// Shared reply pipeline every channel uses.
async function agentReply(text, meta = {}) {
  publish({ type: "channel.in", channel: meta.channel, text: text?.slice(0, 200) });
  const { text: out, provider } = await respond([{ role: "user", content: text }]);
  publish({ type: "channel.out", channel: meta.channel, provider, text: out?.slice(0, 200) });
  return out;
}

const _handles = new Map(); // id -> { stop, info, pending }

export async function startChannels({ log = console.log } = {}) {
  const cfg = load();
  const active = [];
  for (const [id, conf] of Object.entries(cfg.channels || {})) {
    if (!conf?.enabled) continue;
    const loader = CHANNELS[id];
    if (!loader) { log(`[channels] unknown channel: ${id}`); continue; }
    try {
      const mod = await loader();
      const handle = await mod.start({ id, config: conf, onMessage: agentReply, log, publish });
      _handles.set(id, handle);
      if (handle?.pending) {
        log(`[channels] ${id} scaffold loaded (not active)`);
      } else {
        active.push(id);
        log(`[channels] ${id} active${handle?.info ? ` (${handle.info})` : ""}`);
      }
    } catch (e) {
      log(`[channels] ${id} failed: ${e.message}`);
    }
  }
  if (!active.length) log("[channels] no active channels (enable + add a token in onboarding or ~/.bajaclaw/config.json)");
  return active;
}

export function stopChannels() {
  for (const h of _handles.values()) { try { h?.stop?.(); } catch {} }
  _handles.clear();
}

export const CHANNEL_IDS = Object.keys(CHANNELS);
