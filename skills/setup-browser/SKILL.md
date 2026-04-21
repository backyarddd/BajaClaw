---
name: setup-browser
description: Enable browser automation (click, type, navigate, screenshot) via the Playwright MCP server
version: 0.1.0
tools: [Bash]
triggers: ["enable browser", "setup browser", "add browser", "browser automation", "playwright", "let you browse", "agent browse", "agent use browser", "book a table", "buy me", "order me", "scrape this site", "click through", "fill out form", "sign up for"]
effort: low
---

## Non-negotiable rule: never ask "what do you want to use it for"

When the user asks to enable browser automation, "set up browser", or
asks you to do something that obviously needs a real browser (click
buttons, fill forms, log in, scrape a site, book a table, buy a
thing), just enable it and proceed. Do not ask:

- "What do you want to use the browser for?"
- "Headless or visible?"
- "What browser?"

The default is chromium, headless, via Playwright MCP. Enable it and
do the task.

## What this does

Adds `@playwright/mcp` to the profile's MCP config and pre-downloads
chromium. Next cycle, the agent sees browser tools exposed through
MCP: `browser_navigate`, `browser_click`, `browser_type`,
`browser_snapshot`, `browser_screenshot`, `browser_fill`, etc. No
global install needed because it runs via npx.

## Procedure

1. Check whether it is already enabled:

   ```bash
   bajaclaw browser status
   ```

2. If not, enable it:

   ```bash
   bajaclaw browser enable
   ```

   This adds the MCP server to `~/.bajaclaw/profiles/<profile>/mcp-config.json`
   and runs `npx playwright install chromium` (first run only, ~150 MB).

3. Tell the user what you enabled:
   - MCP server `playwright` added to the profile
   - Chromium installed (mention if the install step failed and they
     need to run `npx playwright install chromium` manually)
   - The next cycle will pick up the new tools automatically

4. If the user asked you to *do* a browser task at the same time
   ("book me a table at Nobu Friday"), continue directly into that
   task after the enable succeeds. Do not wait for them to ask again.

## Common patterns

- Scrape + summarize: navigate -> browser_snapshot -> parse DOM -> report
- Form fill: navigate -> browser_fill (or browser_type) -> browser_click -> confirm
- Login-required workflow: warn the user that credentials will go
  through the visible browser on first run; Playwright persists
  session state to a default profile dir

## Pitfalls

- First navigate after enable may feel slow because playwright
  downloads the browser on cold MCP start.
- Some sites block headless browsers. If scraping fails, try adding
  `--headed` to the MCP args (requires editing mcp-config.json).
- Playwright MCP ships default tools but does not include arbitrary
  JS execution in the page; if the agent needs `evaluate()`-style
  access, say so to the user and suggest updating the MCP server to
  a newer version.

## Verification

After `bajaclaw browser enable` completes, run:

```bash
bajaclaw browser status
```

Expected: `✓ browser tool enabled...`. Then in chat, ask the agent
to visit a simple page:

> go to example.com and tell me what the page says

The agent should navigate, take a snapshot, and summarize.
