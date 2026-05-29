# Contributing

Thanks for your interest in BajaClaw.

## Local development

Requires Node.js >= 22.19.

```bash
git clone https://github.com/backyarddd/BajaClaw.git
cd BajaClaw
npm run smoketest        # exercises every module (no network login needed)

# web UI
cd web && npm install && npm run build   # outputs web/dist
npm run dev              # vite dev server

# run the CLI from source
node bin/bajaclaw.mjs --help
```

The runtime has no production dependencies; it uses Node built-ins (`http`,
`crypto`, global `fetch`/`WebSocket`). The web app uses React + Vite.

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: CLI in `bin/`, core
in `src/` (llm, auth, agent, config, daemon, onboarding, ui), feature modules in
`plugins/`, messaging in `channels/`, and the web UI in `web/`.

## Conventions

- ESM throughout (`.mjs` for the agent, `.jsx` for the web app).
- Keep the runtime dependency-free where reasonable; prefer Node built-ins.
- Do not use em dashes anywhere (code, comments, docs, commit messages). Use a
  comma, colon, parentheses, or rephrase.
- Add or update a smoketest check for new behavior; `npm run smoketest` must pass.
- Keep files focused; a file that grows large is usually doing too much.

## Adding things

- **A provider**: add an entry to `REGISTRY` in `src/llm/client.mjs` and, if it
  is not OpenAI-compatible, a small adapter with a delta picker.
- **A channel**: add `channels/<id>.mjs` exporting
  `start({ id, config, onMessage, log, publish })`. See
  [docs/CHANNELS.md](docs/CHANNELS.md).

## Pull requests

Run `npm run smoketest` and build the web UI before opening a PR. Describe what
changed and why. Small, focused PRs are easier to review.
