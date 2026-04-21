---
name: setup-discord
description: Wire up a bidirectional Discord chat bridge between the user and the agent
version: 0.3.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup discord", "help me with discord", "connect discord", "discord bot", "add discord", "discord setup", "discord chat", "talk to you on discord"]
effort: medium
---

## Non-negotiable rule: never ask "what do you want to use it for"

When the user triggers this skill - "set up discord", "connect
discord", "discord bot" - the intent is **always the same**: a
two-way chat bridge. Do not ask:

- "What do you want to use Discord for?"
- "Notifications or something else?"
- "What should the bot do in the channel?"

Wire it up. If they want something specific, they will say so.
Otherwise: silence, collect credentials, run the commands.

## Step 1 - Collect credentials

Discord needs three values. Tell the user exactly this:

```
Three steps to get what I need:

  1) https://discord.com/developers/applications
     -> New Application -> name it -> Create -> "Bot" tab ->
     Reset Token -> copy.
     Under "Privileged Gateway Intents", enable MESSAGE CONTENT INTENT.

  2) OAuth2 -> URL Generator: tick `bot` + `applications.commands`,
     plus "Send Messages" and "Read Message History". Visit the
     generated URL to add the bot to your server.

  3) Discord -> Settings -> Advanced -> Developer Mode ON.
     Right-click the channel you want the bot in -> Copy Channel ID.
     Right-click your own avatar -> Copy User ID.

Paste three values: bot token, channel id, your user id.
```

Wait for all three. Don't proceed partial.

## Step 2 - Wire the channel (auto-fixes missing deps)

```bash
profile="${BAJACLAW_PROFILE:-default}"

if ! bajaclaw channel add "$profile" discord --token "$TOKEN" --channel-id "$CHANNEL_ID" --user-id "$USER_ID" 2>/tmp/bc-dc-err; then
  if grep -q "Cannot find module" /tmp/bc-dc-err || grep -q "discord.js" /tmp/bc-dc-err; then
    echo "Missing optional dep; rebuilding bajaclaw..."
    npm install -g bajaclaw --force
    bajaclaw channel add "$profile" discord --token "$TOKEN" --channel-id "$CHANNEL_ID" --user-id "$USER_ID"
  else
    cat /tmp/bc-dc-err >&2
    exit 1
  fi
fi
```

`--force` refreshes bajaclaw's install and pulls in `discord.js`
(which is in `optionalDependencies`). Runs only if the adapter
actually failed to load.

## Step 3 - Start the daemon

```bash
bajaclaw daemon start "$profile"
```

Dashboard boots in-process.

## Step 4 - Verify + invite the user to test

```bash
bajaclaw channel list "$profile"
bajaclaw daemon status "$profile"
```

Tell the user:

> Done. Send any message in the channel you added me to and I'll
> reply. First response may take a few seconds while the first
> cycle boots.

## Verification

- `bajaclaw channel list "$profile"` shows the discord row with
  masked token and the allowlist containing the user id.
- `bajaclaw daemon status "$profile"` shows `running (pid N)`.
- A test message appears in `bajaclaw daemon logs "$profile"
  --lines 30` as a `gateway.discord.msg` entry.
- The bot reply appears in the channel within ~10s.

## Pitfalls

- **MESSAGE CONTENT INTENT off.** Message bodies arrive empty;
  bot can't respond. Re-check the portal only if the user reports
  "not picking up messages".
- **Bot not in server.** The OAuth2 invite URL step was skipped.
  Walk them through it.
- **DMs.** To enable, remove the channelId filter from config or
  set it to the user's DM channel id.
- **Never echo the token** once it's in config.json.
- **Developer Portal is manual.** There's no API to create Discord
  applications for the user. The surrounding setup is fluid, but
  this step remains human.
