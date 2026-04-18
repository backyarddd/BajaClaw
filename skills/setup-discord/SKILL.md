---
name: setup-discord
description: Wire up a bidirectional Discord chat bridge between the user and the agent
version: 0.2.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup discord", "help me with discord", "connect discord", "discord bot", "add discord", "discord setup", "discord chat", "talk to you on discord"]
effort: medium
---

## Default intent — do NOT ask clarifying questions

When the user says any form of "set up discord", "connect discord",
"talk to you on discord", etc. the default intent is **a two-way chat
bridge**: the user posts to a Discord channel where the bot lives, the
bot forwards the message to BajaClaw as a task, and the agent's reply
is posted back in the same channel (or the user's DM channel).

Don't ask "what do you want to use it for?" or present alternatives.
Just execute the setup below. If the user later clarifies they want
something different, adjust then.

## Execution plan

You have `Bash`, `Read`, `Write`, `Edit` tools. Permission prompts are
auto-approved. Do the work.

### Step 1 — Collect credentials from the user

Tell the user exactly three things:

```
To wire up a Discord chat with me, I need three things. Steps:

  1) Go to https://discord.com/developers/applications
     → New Application → name it → create → "Bot" tab → Reset Token → copy.
     Under "Privileged Gateway Intents", enable "MESSAGE CONTENT INTENT".

  2) In OAuth2 → URL Generator, tick `bot` + `applications.commands`
     plus "Send Messages" + "Read Message History". Visit the generated
     URL to add the bot to your server.

  3) In Discord, Settings → Advanced → Developer Mode ON.
     Then right-click the channel you want the bot in → Copy Channel ID.
     And right-click your own avatar → Copy User ID.

Paste the three values: bot token, channel id, your user id.
```

Wait for all three. Don't proceed partial.

### Step 2 — Wire the channel

```bash
bajaclaw channel add <profile> discord --token <TOKEN> --channel-id <CHANNEL_ID>
```

Then add the user id to the allowlist by editing
`~/.bajaclaw/profiles/<profile>/config.json`. Find the discord entry
under `channels[]` and set `allowlist: [<USER_ID>]` (as a number).

Verify:

```bash
bajaclaw channel list <profile>
```

### Step 3 — Ensure the dep is present

```bash
npm install -g discord.js
```

### Step 4 — Start the gateway

```bash
bajaclaw daemon start <profile>
```

### Step 5 — Confirm and invite a test message

Say: "Done. Go to the channel you added me to and send any message —
I'll reply there."

## Verification checklist

- `bajaclaw channel list <profile>` shows a `discord` entry with the
  token masked and the allowlist containing the user id.
- `bajaclaw daemon status <profile>` shows `running`.
- A test message in the channel appears as `gateway.discord.msg` in
  `bajaclaw daemon logs <profile> --lines 30`.
- The user sees the bot reply within ~10s.

## Pitfalls (to anticipate, not pre-ask)

- If MESSAGE CONTENT INTENT is off in the portal, message bodies are
  empty and the bot can't respond to content. Ask them to re-check
  only if they report it's "not picking up messages."
- If the bot isn't in the server, the OAuth2 invite URL step was
  missed — walk them through it if needed.
- To include DMs, remove the `channelId` filter from the config or
  set it to the user's DM channel id.
- Don't echo the token back after it's in config.json.
