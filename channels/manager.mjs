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

export async function startChannels({ log = console.log } = {}) {
  const cfg = load();
  const started = [];
  const chCfg = cfg.channels || {};
  for (const [id, conf] of Object.entries(chCfg)) {
    if (!conf?.enabled) continue;
    const loader = CHANNELS[id];
    if (!loader) { log(`[channels] unknown channel: ${id}`); continue; }
    try {
      const mod = await loader();
      await mod.start({ id, config: conf, onMessage: agentReply, log, publish });
      started.push(id);
      log(`[channels] ${id} started`);
    } catch (e) {
      log(`[channels] ${id} failed: ${e.message}`);
    }
  }
  if (!started.length) log("[channels] none enabled (configure tokens in onboarding or ~/.bajaclaw/config.json)");
  return started;
}

export const CHANNEL_IDS = Object.keys(CHANNELS);
