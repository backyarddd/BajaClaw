---
name: setup-telegram
description: Wire up a bidirectional Telegram chat bridge between the user and the agent
version: 0.2.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup telegram", "help me with telegram", "connect telegram", "telegram bot", "add telegram", "telegram setup", "telegram chat", "message you on phone", "phone chat", "mobile chat"]
effort: medium
---

## Default intent — do NOT ask clarifying questions

When the user says any form of "set up telegram", "connect telegram",
"talk to you on my phone", etc. the default intent is **a two-way
chat bridge**: the user sends messages to a Telegram bot, those
messages become BajaClaw tasks, and the agent's replies are sent
back to the same Telegram thread.

Don't ask "what do you want to use it for?" or present alternatives
(notifications / bot-that-does-X / something else). Just execute the
setup below. If the user later clarifies they want something different,
adjust then.

## Execution plan

You have `Bash`, `Read`, `Write`, `Edit` tools. Permission prompts are
auto-approved by BajaClaw's backend invocation. Just do the work.

### Step 1 — Collect credentials from the user

Tell the user exactly two things to get:

```
To wire up a Telegram chat with me, I need:

  1) A bot token from @BotFather
     In Telegram, message @BotFather → /newbot → follow the prompts
     → copy the token (looks like 123456789:ABCdef...).

  2) Your numeric Telegram user ID from @userinfobot
     Message @userinfobot → copy the number it replies with.

Paste both here and I'll wire it up.
```

Wait for the user to reply with the token + user id. Don't proceed
without both — without the user id the allowlist is empty and no
messages will route through.

### Step 2 — Wire the channel

Once you have both values, run:

```bash
bajaclaw channel add <profile> telegram --token <TOKEN> --channel-id <USER_ID>
```

Where `<profile>` is the currently active profile (default: `default`
unless BAJACLAW_PROFILE is set to something else in the environment).

Then verify:

```bash
bajaclaw channel list <profile>
```

### Step 3 — Ensure the dep is present

The adapter uses `node-telegram-bot-api` (optional dependency). Check
if it's installed; if not, install it globally:

```bash
npm install -g node-telegram-bot-api
```

### Step 4 — Start the gateway

```bash
bajaclaw daemon start <profile>
```

The daemon hosts the telegram adapter that polls for messages.

### Step 5 — Confirm and invite the user to test

Say something like: "Done. Open Telegram, send any message to the bot
(it'll be named whatever you picked in @BotFather), and I'll reply."

## Verification checklist

- `bajaclaw channel list <profile>` shows a `telegram` entry with the
  token set (printed as `***…<last 4 chars>`) and the allowlist
  containing the user's numeric id.
- `bajaclaw daemon status <profile>` shows `running`.
- Sending a message from Telegram lands in `bajaclaw daemon logs
  <profile> --lines 30` as a `gateway.telegram.msg` entry.
- The user sees a reply in the Telegram thread (may take a few seconds
  for the cycle to run on first message).

## Pitfalls (to anticipate, not pre-ask)

- Bot cannot DM the user first — the user must message the bot first
  OR add the bot to a group. Tell the user this only if they report
  "I don't see anything happen."
- If the token is wrong: `gateway.telegram.error` will appear in the
  daemon log within ~10 seconds. Ask them to re-check the token.
- Never echo the token back in the chat once it's in config.json.
- `bajaclaw uninstall --keep-data` preserves the channel config;
  full uninstall removes it.
