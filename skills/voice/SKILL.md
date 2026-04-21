---
name: voice
description: Transcribe voice notes and speak replies aloud through the active channel
version: 0.1.0
tools: [Bash]
triggers: ["voice reply", "reply by voice", "speak your reply", "send voice", "voice message", "say it out loud", "read that aloud", "transcribe audio", "transcribe this", "speech to text", "text to speech", "tts", "whisper"]
effort: low
---

## When to use this

- The user asks you to reply as a voice message.
- The user sent a voice note and wants you to respond to what they
  said (the gateway already transcribes inbound voice with
  `OPENAI_API_KEY`; you see "[voice transcript] ..." in the task).
- The user asks you to transcribe an audio file they referenced.

## The one-liners

Speak a reply aloud back to the channel (image gen F6 wired
outbound attachments for every channel):

```bash
bajaclaw tts "<what you want the user to hear>" --attach
```

Transcribe an audio file the user attached or referenced:

```bash
bajaclaw transcribe <path> --quiet
```

## Provider selection

- TTS: OpenAI (`OPENAI_API_KEY`, default model `tts-1`, voice
  `alloy`); ElevenLabs (`ELEVENLABS_API_KEY`, any voice id); macOS
  `say` + `afconvert` as a zero-key local fallback.
- Transcribe: OpenAI whisper-1 only for now.

If neither key is set on non-macOS, `tts` will error; pick something
the user can install or ask them to set a key.

## Procedure

1. Keep text short for voice. 1-2 sentences maximum on Telegram /
   iMessage; longer is a wall of audio no one listens to.
2. Use natural spoken phrasing. "It is sunny" is cleaner than
   "It's sunny :)". Do not read emoji aloud. Do not read code aloud.
3. Run the command with `--attach` so the audio lands in the
   originating channel. On Telegram the voice file plays inline; on
   Discord and iMessage it attaches as a downloadable file.
4. In your final text reply (the one that closes the cycle) mention
   briefly that a voice reply was sent, but do not repeat the full
   content - the user already has it.

## Pitfalls

- OpenAI tts has a hard character limit (~4096) per request. Long
  replies get cut. Chunk or summarize.
- The `system` provider (`say`) produces AIFF natively; the wrapper
  converts to m4a via `afconvert` because Telegram rejects AIFF.
  Output will not be available on Linux without a key set.
- ElevenLabs voice ids are strings like
  `21m00Tcm4TlvDq8ikWAM` (Rachel, default). Don't make them up.

## Verification

Success: the CLI prints the output path and (if `--attach`) a second
line `✓ attached <path>`. Failure: clean error line naming the
missing key or the HTTP status.
