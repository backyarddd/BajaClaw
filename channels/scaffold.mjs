// Native channel scaffold for integrations that need more than a token + HTTP
// long-poll. Each has a clear native path; this gives the structure and an
// honest status instead of a fake "connected". Implement per channel as needed.
//
//   slack    -> Socket Mode: app-level token + WebSocket (api.slack.com).
//   whatsapp -> WhatsApp Cloud API (Meta) webhook, or a local web bridge.
//   imessage -> macOS: poll ~/Library/Messages/chat.db (Full Disk Access),
//               send via AppleScript (osascript). macOS only.
const PATHS = {
  slack: "Socket Mode (app-level token + WebSocket)",
  whatsapp: "WhatsApp Cloud API webhook or local bridge",
  imessage: "macOS chat.db poll + AppleScript send (Full Disk Access required)",
};

export async function start({ id, config, log }) {
  log?.(`[${id}] scaffold loaded. Native path: ${PATHS[id] || "custom"}. ` +
    `Provide credentials in ~/.bajaclaw/config.json and implement channels/${id}.mjs to activate.`);
  // No-op runner: keeps the manager happy without pretending to be connected.
  return {
    stop() {},
    info: "scaffold (not active)",
    pending: true,
  };
}
