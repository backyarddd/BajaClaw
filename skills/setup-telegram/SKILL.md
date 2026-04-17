---
name: setup-telegram
description: Walk the user through adding a Telegram bot adapter to BajaClaw
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup telegram", "help me with telegram", "connect telegram", "telegram bot", "add telegram", "telegram setup"]
effort: medium
---

## When to use
The user asks you to connect Telegram, add a Telegram bot, forward DMs
through a bot, or receive/send BajaClaw tasks over Telegram.

## Quick reference
- Adapter: `src/channels/gateway.ts`, uses `node-telegram-bot-api` (optional dep)
- Token source: Telegram's `@BotFather` — `/newbot` → `/token`
- Allowlist: the user's numeric Telegram user id (from `@userinfobot`)
- Stored in: `~/.bajaclaw/profiles/<profile>/config.json` → `channels[]`

## Procedure
1. Check for an existing token. Ask: "do you already have a Telegram bot token?"
   - If no: tell them to open Telegram, message `@BotFather`, send `/newbot`,
     pick a name and username. BotFather replies with a token shaped like
     `<digits>:<alphanumeric>`. Copy it.
2. Ask for their numeric Telegram user id. They can get it by messaging
   `@userinfobot`. Without this the allowlist is empty and no messages get
   through.
3. Run: `bajaclaw channel add <profile> telegram --token <TOKEN>` (replace
   `<profile>` with their active profile — default is `default`).
4. Edit `~/.bajaclaw/profiles/<profile>/config.json`. Inside
   `channels[0].allowlist`, put `[<NUMERIC_USER_ID>]`. Example:
   `"allowlist": [123456789]`
5. Start the gateway: `bajaclaw daemon start <profile>` (or a dedicated
   gateway subprocess if you're keeping the daemon off).
6. Ask the user to message their bot. Expect a new task to appear in
   `bajaclaw status <profile>` and a `gateway.telegram.msg` entry in the
   logs.

## Pitfalls
- `npm install node-telegram-bot-api` in the BajaClaw install dir if the
  dependency is missing (it's an `optionalDependencies` entry).
- Empty allowlist → zero messages accepted. Confirm the id is present.
- Bot cannot initiate a conversation — the user must message the bot first
  OR the bot must be added to a group.
- Never paste the token into a public log or chat. If it leaks, revoke via
  BotFather `/revoke`.
- `bajaclaw uninstall` removes all channel configs as part of profile
  teardown.

## Verification
- `bajaclaw channel list <profile>` shows the telegram entry.
- `bajaclaw daemon logs <profile> --lines 50` includes `gateway.telegram.msg`
  after a test message.
- `bajaclaw status <profile>` shows the pending-tasks counter rising.
