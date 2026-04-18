# Contributing

## Dev setup

```
git clone <your-fork-url> bajaclaw
cd bajaclaw
npm install
npm run lint       # tsc --noEmit
npm test
```

Node 20+. `better-sqlite3` ships prebuilt binaries for the common
platforms - if yours is exotic, you may need a toolchain.

## Running from source

```
./bin/bajaclaw.js doctor
./bin/bajaclaw.js init test-agent --template custom
./bin/bajaclaw.js start test-agent --dry-run
```

The launcher at `bin/bajaclaw.js` uses `tsx` to run `src/cli.ts` in dev, or
`dist/cli.js` when a built artifact is present.

## Layout

- `src/` - TypeScript, strict mode
- `templates/<template>/` - starter files copied on `bajaclaw init`
- `skills/` - built-in SKILL.md bundles
- `docs/` - user + dev documentation
- `tests/` - `node --test` smoke tests
- `bin/` - node launchers

## Style

- No emojis in code/docs/commit messages unless specifically asked for.
- Comments explain *why*, not *what*. Keep them short.
- Don't add abstractions before you have three call-sites. Don't pre-plan
  for hypothetical future features.
- No error-handling for cases that can't happen. Trust internal call-sites.
- Cross-platform or it isn't done: every path via `path.join`, every exec
  via `execa` with arg arrays and `shell: false`.

## Commits

- Conventional-ish: `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`.
- Keep subject line ≤72 chars.
- For multi-file changes, describe the *why* in the body.

## Pull requests

- One logical change per PR.
- Run `npm run lint && npm test` before opening.
- Add/update tests for behaviour changes.
- Update `CHANGELOG.md` under the current unreleased section.
- Don't bump `version` in `package.json` - that's done in release.

## Release checklist

1. All CI green on main
2. `CHANGELOG.md` has an entry for the new version
3. `npm version <patch|minor|major>` (edits package.json, tags)
4. `git push && git push --tags`
5. `npm publish`

BajaClaw's auto-update checks the npm registry - once you `npm publish`, all
installed clients see the update notice within 24h.

## License

MIT. By contributing, you agree your contributions are licensed under MIT.
