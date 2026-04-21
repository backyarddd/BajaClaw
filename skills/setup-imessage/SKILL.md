---
name: setup-imessage
description: Wire up a bidirectional iMessage chat bridge on macOS
version: 0.1.0
tools: [Bash, Read, Write, Edit]
platforms: [macos, darwin]
triggers: ["setup imessage", "imessage bot", "connect imessage", "add imessage", "imessage setup", "message me on imessage", "chat on messages", "macos messages", "apple messages"]
effort: medium
---

## Non-negotiable rule: never ask "what do you want to use it for"

When the user triggers this skill, the intent is the same every time:
a two-way iMessage bridge so they can text the agent from any iPhone/
iPad/Mac on their Apple ID. Do not ask "what should it do?" - wire it
up.

## Platform gate

iMessage only works on macOS. If `uname` is not `Darwin`, refuse
with a clear message:

```bash
if [ "$(uname)" != "Darwin" ]; then
  echo "iMessage requires macOS - you're on $(uname). Try Telegram or Discord instead."
  exit 1
fi
```

## Step 1 - Collect the contact handle(s)

Tell the user exactly this:

```
Which handle(s) should route to this agent? You can give me:

  - a phone number in any format (+15551234567, (555) 123-4567, etc.)
  - an Apple ID email (you@icloud.com, you@gmail.com, etc.)
  - both (e.g. your own phone and your partner's email)

Messages from anyone else will be ignored. You can add more later.
```

Wait for at least one handle. Multiple is fine - each becomes an
allowlist entry.

## Step 2 - Wire the channel (auto-handles permission gate)

```bash
profile="${BAJACLAW_PROFILE:-default}"

# Repeatable --contact supports multiple allowlist entries
bajaclaw channel add "$profile" imessage --contact "$CONTACT1" ${CONTACT2:+--contact "$CONTACT2"}
```

The command auto-probes Full Disk Access and opens the System
Settings pane if it's not granted. If the user sees the pane appear,
tell them:

```
macOS opened Privacy & Security -> Full Disk Access. Toggle the
switch for the app running bajaclaw (Terminal, iTerm, VS Code,
etc.). Once it's on, come back here and I'll keep going.
```

Wait for the user to confirm. Re-probe if needed:

```bash
# Loop until FDA is granted or the user tells you to stop
while ! sqlite3 ~/Library/Messages/chat.db "SELECT 1 LIMIT 1" >/dev/null 2>&1; do
  echo "Still waiting on Full Disk Access. Toggle it in System Settings, then hit enter here."
  read -r
done
```

## Step 3 - Restart the daemon to start the iMessage poller

```bash
bajaclaw daemon restart "$profile"
```

The first time the daemon tries to send a reply, macOS will prompt
once for Automation permission on Messages.app. Tell the user:

```
The first time I reply, macOS will ask whether to let bajaclaw
control Messages. Click Allow. You only see this once.
```

## Step 4 - Verify

```bash
bajaclaw channel list "$profile"
bajaclaw daemon status "$profile"
```

Ask the user to text the bot from the allowlisted handle. Watch:

```bash
bajaclaw daemon logs "$profile" --lines 20
```

Expect a `gateway.imessage.msg` entry within 2-3 seconds. The reply
goes back through Messages.app and appears in the same thread.

## Verification checklist

- `bajaclaw channel list "$profile"` shows an `imessage` row with
  the contact handle(s).
- `bajaclaw daemon status "$profile"` shows `running (pid N)`.
- A test iMessage from the allowlisted handle produces a
  `gateway.imessage.msg` log line within ~3 seconds.
- The user receives a reply in the Messages.app thread.

## Pitfalls

- **Full Disk Access is per-binary.** It's granted to the app that
  launched bajaclaw (Terminal.app, iTerm, VS Code's shell, etc.).
  If the user switches terminals, they'll need to grant again for
  the new one.
- **Automation permission prompts on first send only.** If they miss
  it, it stays denied. Open the pane directly:
  `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"`
- **Messages.app must be running** for sends to work. AppleScript
  will auto-launch it if closed, but first launch can be slow.
- **SMS (green bubbles) won't send from a Mac without a phone number
  paired to an iPhone.** Only iMessage contacts (blue bubbles) work.
- **Group chats are v1 not supported.** The adapter filters them out;
  only 1:1 conversations route through.
- **First-run safety.** The adapter seeds its last-seen ROWID to the
  current max on first start, so your historical message backlog
  does NOT get replayed as tasks. This is deliberate.
- **Mac must be awake** for real-time delivery. Messages received
  while asleep surface when the Mac wakes, in order.
- **Never echo the user's contacts back in logs or memory** unless
  specifically asked - they're PII.
