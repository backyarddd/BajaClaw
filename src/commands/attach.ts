// `bajaclaw attach <path>` - pushes a file attachment to the
// originating channel of a running cycle, the same way `bajaclaw say`
// pushes a text progress ping. Reads BAJACLAW_SOURCE +
// BAJACLAW_DASHBOARD_PORT from the env (both injected by
// runCycleInner), POSTs to the dashboard's /api/attach endpoint, and
// fails silent on any network issue - the agent's cycle must not
// error just because the user's phone isn't reachable.
//
// If BAJACLAW_SOURCE is absent, the dashboard falls through to
// broadcastAttachmentToProfile, which sends to whichever channel was
// most recently active for the profile.

import { existsSync } from "node:fs";
import chalk from "chalk";

export async function cmdAttach(filePath: string, opts: { caption?: string }): Promise<void> {
  if (!existsSync(filePath)) {
    console.error(chalk.red(`attach: file not found: ${filePath}`));
    process.exit(1);
  }
  const port = process.env.BAJACLAW_DASHBOARD_PORT ?? "7337";
  const source = process.env.BAJACLAW_SOURCE;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: filePath, source, caption: opts.caption }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && (body as { ok?: boolean }).ok) {
      console.log(chalk.green(`✓ attached ${filePath}`));
    } else {
      console.log(chalk.yellow(`attach: no channel picked up the file`));
    }
  } catch (e) {
    // Silent failure path matches `bajaclaw say` - a dashboard that
    // isn't up should not break a cycle.
    console.error(chalk.dim(`attach: dashboard unreachable (${(e as Error).message})`));
  }
}
