---
name: setup-telegram
description: Wire up a bidirectional Telegram chat bridge between the user and the agent
version: 0.3.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup telegram", "help me with telegram", "connect telegram", "telegram bot", "add telegram", "telegram setup", "telegram chat", "message you on phone", "phone chat", "mobile chat"]
effort: medium
---

## Non-negotiable rule: never ask "what do you want to use it for"

When the user triggers this skill - "set up telegram", "connect
telegram", "telegram bot", "talk to you on my phone" - the intent
is **always the same**: a two-way chat bridge. Do not ask:

- "What do you want to use Telegram for?"
- "Notifications, commands, or something else?"
- "What should this bot do?"

Wire it up. If they want something specific (e.g. "only alerts"),
they will say so. Otherwise: silence, collect credentials, run
the commands.

## Step 1 - Collect credentials

Telegram requires two things. Tell the user exactly this:

```
I need two things from Telegram:

  1) A bot token from @BotFather
     In Telegram: message @BotFather -> /newbot -> follow the prompts
     -> copy the token (looks like 123456789:ABCdef...).

  2) Your numeric Telegram user ID from @userinfobot
     In Telegram: message @userinfobot -> copy the number it replies
     with.

Paste both and I'll handle the rest.
```

Don't proceed without both. Without the user id, the allowlist is
empty and no messages route through.

## Step 2 - Wire the channel (auto-fixes missing deps)

Run this first, inside a try/catch shell pattern. If it succeeds,
skip to step 3. If it fails because a module is missing, run the
fix and retry:

```bash
profile="${BAJACLAW_PROFILE:-default}"

# First attempt
if ! bajaclaw channel add "$profile" telegram --token "$TOKEN" --user-id "$USER_ID" 2>/tmp/bc-tg-err; then
  if grep -q "Cannot find module" /tmp/bc-tg-err || grep -q "node-telegram-bot-api" /tmp/bc-tg-err; then
    echo "Missing optional dep; rebuilding bajaclaw..."
    npm install -g bajaclaw --force
    # Retry after the rebuild
    bajaclaw channel add "$profile" telegram --token "$TOKEN" --user-id "$USER_ID"
  else
    cat /tmp/bc-tg-err >&2
    exit 1
  fi
fi
```

The `--force` flag refreshes bajaclaw's whole install, including
`optionalDependencies` (`node-telegram-bot-api`, `discord.js`). Only
runs when the adapter actually failed to load - no-op otherwise.

## Step 3 - Start the daemon

```bash
bajaclaw daemon start "$profile"
```

The daemon hosts the Telegram adapter that polls for messages. It
also boots the dashboard in-process.

## Step 4 - Verify and invite the user to test

```bash
bajaclaw channel list "$profile"       # expect one telegram row
bajaclaw daemon status "$profile"      # expect "running"
```

Then tell the user:

> Done. Open Telegram, send any message to the bot (the name you
> picked in @BotFather), and I'll reply. The first reply may take
> a few seconds while the first cycle boots.

## Verification

- `bajaclaw channel list "$profile"` shows the telegram row with
  token shown as `***…<last 4>` and the allowlist containing the
  user's numeric id.
- `bajaclaw daemon status "$profile"` shows `running (pid N)`.
- Sending a message from Telegram lands in
  `bajaclaw daemon logs "$profile" --lines 30` as a
  `gateway.telegram.msg` entry.
- The user sees a reply in the Telegram thread.

## Pitfalls

- **Bot cannot DM the user first.** The user must message the bot
  first (or add it to a group). Tell the user only if they report
  "nothing happens" after step 4.
- **Wrong token:** a `gateway.telegram.error` entry appears in the
  daemon log within ~10 seconds. Ask the user to re-check the token.
- **Never echo the token** back in chat once it's in config.json.
  Refer to it as "the token you gave me".
- **BotFather is manual.** There's no API to create bots for the
  user - they must do it themselves. The skill makes the surrounding
  setup fluid, but this step remains human.
