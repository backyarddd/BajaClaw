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

The default is chromium, headless, via Playwright MCP, with caps
`vision,pdf,storage` and viewport `1280x800`. Enable it and do the
task.

## What this does

Adds `@playwright/mcp` to the profile's MCP config and pre-downloads
chromium. Next cycle, the agent sees a rich set of browser tools
exposed through MCP. No global install needed because it runs via
npx.

Core tools always available:

- Navigation: `browser_navigate`, `browser_navigate_back`, `browser_wait_for`, `browser_close`
- Interaction: `browser_click`, `browser_hover`, `browser_drag`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_fill_form`, `browser_file_upload`, `browser_handle_dialog`
- Introspection: `browser_snapshot` (a11y tree - the primary "what's on the page"), `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`
- Scripting: `browser_evaluate` (arbitrary JS), `browser_run_code`
- Tabs: `browser_tabs`

Default caps (`vision,pdf,storage`) add:

- `browser_mouse_click_xy`, `browser_mouse_move_xy`, `browser_mouse_drag_xy` - coordinate-based clicks as a fallback when ref-based selection fails
- `browser_pdf_save` - save the current page as a PDF
- `browser_cookie_*`, `browser_localstorage_*`, `browser_sessionstorage_*`, `browser_storage_state` - cookies and local/session storage inspection + mutation; session persists across cycles by default

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
   - Mode (headless by default), viewport (1280x800 by default), caps
     (vision, pdf, storage by default)
   - Chromium installed (mention if the install step failed and they
     need to run `npx playwright install chromium` manually)
   - The next cycle will pick up the new tools automatically

4. If the user asked you to *do* a browser task at the same time
   ("book me a table at Nobu Friday"), continue directly into that
   task after the enable succeeds. Do not wait for them to ask again.

## Flags

- `--headed` launch a visible browser window (useful for debugging or
  for sites that block headless browsers)
- `--caps <list>` override default caps. Examples: `--caps ""` for no
  extras, `--caps vision,pdf,storage,network,testing` for everything
  practical. Known caps: `vision`, `pdf`, `devtools`, `storage`,
  `network`, `testing`, `config`.
- `--viewport <WxH>` override the default `1280x800`
- `--no-install` skip the chromium download step

## Common patterns

- Scrape + summarize: navigate -> browser_snapshot -> parse DOM -> report
- Form fill: navigate -> browser_fill (or browser_type) -> browser_click -> confirm
- Login-required workflow: warn the user that credentials will go
  through the visible browser on first run; Playwright persists
  session state to a default profile dir

## Pitfalls

- First navigate after enable may feel slow because playwright
  downloads the browser on cold MCP start.
- Some sites detect and block headless browsers. If a site misbehaves,
  re-enable with `bajaclaw browser enable --headed` so a real window
  opens.
- The session (cookies, localStorage) persists across cycles because
  storage cap is on. Great for "stay logged in" flows; bad if you
  want fresh-slate per task. For a throwaway run, disable + re-enable
  with `--caps ""` or pass `--caps vision,pdf` to drop storage.
- `browser_evaluate` runs arbitrary JS in the page context and is on
  by default. Treat returned values as untrusted.

## Verification

After `bajaclaw browser enable` completes, run:

```bash
bajaclaw browser status
```

Expected: `✓ browser tool enabled...`. Then in chat, ask the agent
to visit a simple page:

> go to example.com and tell me what the page says

The agent should navigate, take a snapshot, and summarize.
