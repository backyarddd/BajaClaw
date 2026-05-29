# Channels

Channels let you talk to BajaClaw from a messaging app instead of the web UI.
Each inbound message runs through the same agent loop and the reply is sent back.

Enable a channel by setting `enabled: true` and a token in
`~/.bajaclaw/config.json` (or during `bajaclaw onboard`), then `bajaclaw restart`.

## Telegram (native, working)

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the
   prompts, and copy the bot token.
2. Configure it:
   ```json
   "channels": { "telegram": { "enabled": true, "token": "123456:ABC-..." } }
   ```
3. `bajaclaw restart`, then message your bot.

Uses Telegram long-polling (`getUpdates`), so no public URL or webhook is needed.

## Discord (native, working)

1. Create an application at the
   [Discord Developer Portal](https://discord.com/developers/applications), add a
   Bot, and copy its token.
2. Enable the **Message Content Intent** under the Bot settings.
3. Invite the bot to your server with the `bot` scope.
4. Configure it:
   ```json
   "channels": { "discord": { "enabled": true, "token": "..." } }
   ```
5. `bajaclaw restart`, then message the bot.

Uses the Discord Gateway WebSocket plus the REST API.

## Slack, WhatsApp, iMessage (scaffolded)

These ship as scaffolds with a clear native path, not faked as connected. Each
has a `channels/<id>.mjs` you can implement:

- **Slack**: Socket Mode (app-level token + WebSocket).
- **WhatsApp**: WhatsApp Cloud API webhook, or a local web bridge.
- **iMessage**: macOS only. Poll `~/Library/Messages/chat.db` (needs Full Disk
  Access) and send via AppleScript.

Enabling a scaffolded channel logs "scaffold loaded (not active)" rather than
pretending to connect.

## Writing a new channel

A channel module exports `start({ id, config, onMessage, log, publish })` and
returns a handle `{ stop(), info?, pending? }`. Call `onMessage(text, meta)` for
each inbound message; it resolves to the agent's reply, which you send back.
`channels/telegram.mjs` is the simplest working reference.
