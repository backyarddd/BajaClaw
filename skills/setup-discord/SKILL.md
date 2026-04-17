---
name: setup-discord
description: Walk the user through adding a Discord bot adapter to BajaClaw
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup discord", "help me with discord", "connect discord", "discord bot", "add discord", "discord setup"]
effort: medium
---

## When to use
The user asks you to connect Discord, wire up a Discord bot, route messages
from a channel into BajaClaw, or reply from BajaClaw back to Discord.

## Quick reference
- Adapter: `src/channels/gateway.ts`, uses `discord.js` (optional dep)
- Token source: Discord Developer Portal → Applications → New Application →
  Bot → Reset Token
- Required bot intents: Guilds, GuildMessages, MessageContent, DirectMessages
- Channel id: right-click a channel in Discord (Developer Mode on) →
  "Copy Channel ID"

## Procedure
1. Ask if the user already has a Discord bot token + invited the bot to
   their server.
   - If not: walk them to https://discord.com/developers/applications. Steps:
     New Application → Bot tab → Reset Token → copy. Under "Privileged Gateway
     Intents", enable "MESSAGE CONTENT INTENT". Under OAuth2 → URL Generator,
     tick `bot` + `applications.commands`, plus the message permissions,
     and visit the generated URL to add the bot to their server.
2. Ask for the channel id where the bot should listen (Discord Developer
   Mode must be on: Settings → Advanced → Developer Mode).
3. Ask for the user's numeric Discord user id (right-click own avatar →
   Copy User ID). This goes in the allowlist.
4. Run: `bajaclaw channel add <profile> discord --token <TOKEN> --channel-id <CHANNEL_ID>`
5. Edit `~/.bajaclaw/profiles/<profile>/config.json` and add the numeric
   user id to `channels[].allowlist` for the discord entry: `[<USER_ID>]`.
6. Start the gateway: `bajaclaw daemon start <profile>`.
7. Send a test message in the channel; expect it to appear as a task.

## Pitfalls
- `npm install discord.js` if the dep is missing (optional).
- The bot must be added to the server BEFORE it can read messages — OAuth2
  URL step is not optional.
- Without the MessageContent intent enabled in the Developer Portal AND in
  the code (`discord.js` GatewayIntentBits.MessageContent), message bodies
  will be empty strings. The adapter already sets the intent; double-check
  the portal side.
- DMs: set `channelId` to the user's DM channel id OR remove the
  `channelId` filter in the config to accept any channel the bot sees.

## Verification
- `bajaclaw channel list <profile>` shows the discord entry.
- Logs contain `gateway.discord.msg` entries after test messages.
- `bajaclaw status <profile>` shows incremented pending-tasks count.
