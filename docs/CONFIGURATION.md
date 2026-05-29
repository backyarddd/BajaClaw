# Configuration

BajaClaw stores everything under `~/.bajaclaw` (override the whole location with
the `BAJACLAW_HOME` environment variable). The main file is
`~/.bajaclaw/config.json`. It is created on first run; you only need to edit it
for advanced changes. Defaults are merged in, so the file can be partial.

## Example

```json
{
  "defaultProvider": "openai-codex",
  "providerOrder": ["openai-codex", "anthropic", "openrouter", "google"],
  "gateway": { "host": "127.0.0.1", "port": 18789 },
  "ui": { "host": "127.0.0.1", "port": 18790 },
  "openaiEndpoint": { "enabled": true, "host": "127.0.0.1", "port": 11435 },
  "selfUpdate": { "enabled": true, "intervalHours": 24, "mode": "propose" },
  "features": { "hermesBrain": true, "coworkMode": true },
  "channels": {
    "telegram": { "enabled": false, "token": "" },
    "discord":  { "enabled": false, "token": "" }
  }
}
```

## Keys

| Key | Meaning |
|---|---|
| `defaultProvider` | The provider used first. Default `openai-codex` (ChatGPT). |
| `providerOrder` | Fallback order among the providers you have set up. Local providers (ollama, lmstudio) are opt-in here. |
| `gateway.host` / `gateway.port` | The gateway (health + live events). Default `127.0.0.1:18789`. |
| `ui.host` / `ui.port` | The web UI server. Default `127.0.0.1:18790`. |
| `openaiEndpoint.enabled` | Whether to run the local OpenAI API. |
| `openaiEndpoint.host` / `.port` | Default `127.0.0.1:11435` (11434 is left free for Ollama). |
| `openaiEndpoint.mode` | `"agent"` (default: system prompt + memory + logging) or `"raw"` (bare passthrough). Per request, the model `bajaclaw-raw` always forces raw. |
| `openaiEndpoint.upstream` | Optional `{ url, key }` to pass requests straight through to another OpenAI-compatible server instead of the agent. |
| `selfUpdate.mode` | `propose` (write an approve-to-merge proposal), the only safe default. |
| `channels.<id>` | `{ enabled, token }` per channel. See [CHANNELS.md](CHANNELS.md). |

## Ports at a glance

| Service | Default | Notes |
|---|---|---|
| Gateway | 18789 | Health + SSE events for the UI |
| Web UI | 18790 | `bajaclaw ui` opens this |
| Local OpenAI API | 11435 | Point OpenAI clients here |

All bind to localhost by default. Changing a port in `config.json` and running
`bajaclaw restart` is enough; the web UI reads its targets from the same config.

## Credentials

Provider credentials are stored separately from `config.json`, one file per
provider under `~/.bajaclaw/auth/`, mode `0600`:

- ChatGPT: `openai-codex.json` holds the OAuth tokens and account id (created by
  `bajaclaw onboard`, refreshed automatically).
- Key-based providers: `<provider>.json` holds `{ "type": "key", "api_key": "..." }`.

To remove a provider, delete its file in `~/.bajaclaw/auth/`.

## Changing providers later

Run `bajaclaw onboard` again to switch the default or add a provider, or edit
`defaultProvider` / `providerOrder` in `config.json` and `bajaclaw restart`.
