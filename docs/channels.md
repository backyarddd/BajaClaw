# Channels

Three adapters: Telegram, Discord, and iMessage. All are opt-in. Telegram and Discord dependencies are installed only when the optional deps load; iMessage has no extra dependencies and works out of the box on macOS.

Each profile owns its own channels. Different profiles can point at different bots or contacts with zero crossover.

## Telegram

```
bajaclaw channel add <profile> telegram --token <BOT_TOKEN> --user-id <YOUR_TG_USER_ID>
```

- `--token` is the bot token from `@BotFather`.
- `--user-id` is the numeric ID from `@userinfobot`; it populates the sender allowlist. Without it, the bot accepts messages from any user - usually not what you want.
- Image and video attachments are downloaded to a tmp file and passed to the agent as file paths. Videos are pre-split into 8 keyframes via `ffmpeg`.

## Discord

```
bajaclaw channel add <profile> discord --token <BOT_TOKEN> --channel-id <CHANNEL> --user-id <YOUR_ID>
```

- `--token` is the bot token from the Developer Portal.
- `--channel-id` scopes the bot to one server channel.
- `--user-id` is optional; if set, only that user's messages are accepted.
- Requires `MESSAGE CONTENT INTENT` enabled in the Developer Portal.

## iMessage (macOS only)

```
bajaclaw channel add <profile> imessage --contact <handle> [--contact <handle> ...]
```

- `--contact` is a phone number (any format; normalized to E.164) or an Apple ID email. Repeatable for multi-handle allowlists.
- No bot token - authentication is inherited from Messages.app (your Mac's Apple ID).
- First use requires granting Full Disk Access to whichever app launches bajaclaw (Terminal, iTerm, VS Code, etc.). The CLI auto-opens the right System Settings pane.
- First outbound reply triggers a one-time macOS Automation prompt for Messages.app. Click Allow.

Scope in v1: 1:1 iMessage threads only. Group chats are filtered out, and inbound attachments are flagged in the task body as `[attachment]` but not downloaded. Typing indicators and read receipts do not round-trip.

Sending SMS (green bubbles) from the Mac requires Text Message Forwarding with a paired iPhone. BajaClaw routes through iMessage only by default - if Messages.app falls back to SMS on your Mac, that's Apple's routing, not ours.

## Per-agent channel dedication

Channels are per-profile, so one handle routes to one agent. Useful for dedicated agents:

```
bajaclaw profile create gf --template custom
bajaclaw persona gf --edit
bajaclaw channel add gf imessage --contact partner@icloud.com
bajaclaw daemon start gf
```

The `gf` profile has its own daemon, memory, skills, dashboard port (configurable), and cycle history. It never sees messages routed to `default`, and vice versa.

## Permission model (iMessage specific)

Two macOS permissions are required. Both are one-time; they survive daemon restarts but can be re-prompted on macOS major-version upgrades.

1. **Full Disk Access** - reads `~/Library/Messages/chat.db`. Granted in `System Settings → Privacy & Security → Full Disk Access`. The CLI probes on `channel add` and opens the pane if missing.
2. **Automation → Messages** - drives Messages.app via AppleScript. macOS prompts on the first send; accept the dialog once.

Probing programmatically: bajaclaw tries to read the file and catches `EACCES`/`EPERM` to infer the FDA state. AppleScript error `-1743` indicates Automation was denied; the adapter surfaces it with a clear message pointing at the correct pane.

## Routing

Inbound messages (from allowlisted senders) become rows in the `tasks` table with `source = "<kind>:<id>"`:

- `telegram:<chat_id>` - the Telegram chat id.
- `discord:<channel_id>` - the Discord channel id.
- `imessage:<normalized-handle>` - the sender's phone (E.164) or email (lowercased).

The daemon picks them up on the next poll and runs a cycle. The cycle's reply routes back through the same channel. Typing indicators (Telegram/Discord) stay on from message receipt through reply send.

## Gateway internals

All adapters live in the daemon process. Stopping the daemon cleanly ends polling (Telegram long-poll) and the socket connection (Discord) and closes the SQLite handle (iMessage). `startAllGateways` is idempotent; re-running swaps adapters in place.

## Reply and progress

- `replyToSource(profile, source, text)` is the single exit point for outbound messages. It also clears the typing indicator.
- `sendProgressToSource(profile, source, text)` is used by `bajaclaw say` from inside a running cycle for mid-flight progress pings. Does NOT end typing. Available for all three channels.
- `broadcastToProfile(profile, text)` pings the last active chat per adapter (used by the auto-skill learning announcement system).

## Troubleshooting

- **Telegram silent:** check `bajaclaw daemon logs <profile> --lines 30` for `gateway.telegram.poll-err`. Usually a wrong token or rate limit.
- **Discord silent:** confirm MESSAGE CONTENT INTENT is on, and the bot is in the specified channel. Check for `gateway.discord.err`.
- **iMessage silent:** `gateway.imessage.fda-missing` means Full Disk Access is not granted. `gateway.imessage.automation-denied` means the Automation prompt was denied. Re-grant in the respective System Settings panes.
- **Duplicate replies on Telegram:** a stale daemon is still polling. `bajaclaw daemon start` sweeps orphans before spawning, but if you bypassed that (e.g. manually ran `daemon run`), `bajaclaw daemon stop <profile>` and re-start.

## Out of scope (v1)

- WhatsApp, Signal, Slack, SMS-via-Twilio
- Voice / TTS / STT
- Group iMessage chats
- iMessage attachment download (inbound image/video)
- Outbound iMessage attachments (AppleScript doesn't expose a clean path)
