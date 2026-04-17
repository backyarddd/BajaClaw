# Channels

Two optional adapters in v0.1: Telegram and Discord. Both are opt-in; neither
dependency is installed unless you use them.

## Telegram

```
bajaclaw channel add <profile> telegram --token <BOT_TOKEN>
```

- Inbound messages from the sender allowlist are pushed into the tasks queue.
- If allowlist is empty, no messages are accepted. Add your own Telegram user id
  in `config.json` under `channels[].allowlist`.

## Discord

```
bajaclaw channel add <profile> discord --token <BOT_TOKEN> --channel-id <CHANNEL>
```

- Only messages in the matching channel id are accepted.
- Same allowlist rule as Telegram.

## Gateway

`bajaclaw-gateway <profile>` (subprocess) normalizes inbound messages into the
tasks queue. It is optional; if you don't run it, channels are inert.

## Out of scope (v0.1)

- WhatsApp, Signal, iMessage, Slack
- Voice / TTS / STT
