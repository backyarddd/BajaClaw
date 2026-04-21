// `bajaclaw tapback <messageGuid> <type>` - send an iMessage tapback
// (reaction) to a specific message. Best-effort: macOS 14+ may
// reject the AppleScript path due to private IMCore entitlements
// (the same entitlement gate that killed typing in v0.17.x; see
// HANDOFF landmine 48). Caller surfaces a clean failure.
//
// Read receipts (mark inbound as read) are NOT implementable from
// userspace on macOS 14+: the chat.db is SIP-protected and IMCore's
// `markChatAsRead:` requires entitlements only Messages.app holds.
// `bajaclaw read-receipt` is a no-op stub that explains the gap so
// scripted callers don't have to special-case its absence.

import chalk from "chalk";
import { TAPBACK_TYPES, TAPBACK_NAMES } from "../channels/imessage.js";

export interface TapbackOpts {
  messageGuid: string;
  type: string;        // numeric or named ("love" / "thumbsup" / etc.)
  source?: string;     // "imessage:<handle>" - defaults to BAJACLAW_SOURCE
  remove?: boolean;    // 3000-3005 instead of 2000-2005
}

export async function cmdTapback(opts: TapbackOpts): Promise<void> {
  const numeric = resolveType(opts.type);
  if (numeric === null) {
    console.error(chalk.red(`tapback: unknown type '${opts.type}'. valid: ${Object.keys(TAPBACK_TYPES).join(", ")}, or 2000-2005 / 3000-3005`));
    process.exit(2);
  }
  const finalType = opts.remove ? numeric + 1000 : numeric;
  const source = opts.source ?? process.env.BAJACLAW_SOURCE;
  if (!source) {
    console.error(chalk.red("tapback: --source <imessage:handle> required (or set BAJACLAW_SOURCE)"));
    process.exit(2);
  }
  const port = process.env.BAJACLAW_DASHBOARD_PORT ?? "7337";
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/tapback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, messageGuid: opts.messageGuid, type: finalType }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok && (body as { ok?: boolean }).ok) {
      console.log(chalk.green(`✓ tapback ${TAPBACK_NAMES[numeric] ?? finalType} sent`));
    } else {
      console.log(chalk.yellow("tapback: not delivered (channel rejected or unsupported on this macOS)"));
      console.log(chalk.dim("  see HANDOFF.md landmine 48 - macOS 14+ requires private IMCore entitlements"));
    }
  } catch (e) {
    console.error(chalk.red(`tapback: dashboard unreachable (${(e as Error).message})`));
  }
}

export function cmdTapbackList(): void {
  console.log(chalk.bold("Tapback types"));
  for (const [name, n] of Object.entries(TAPBACK_TYPES)) {
    console.log(`  ${name.padEnd(14)} ${n}`);
  }
  console.log("");
  console.log(chalk.dim("Add 1000 to remove a tapback (e.g. 3000 to remove a Love)."));
}

export function cmdReadReceipt(): void {
  console.log(chalk.yellow("read-receipt: not implemented."));
  console.log(chalk.dim("Marking inbound iMessages as read requires either:"));
  console.log(chalk.dim("  - Writing to ~/Library/Messages/chat.db (SIP-protected)"));
  console.log(chalk.dim("  - IMCore.framework's markChatAsRead: (private entitlement, Messages.app only)"));
  console.log(chalk.dim("Both paths are blocked for non-Apple processes on macOS 14+."));
  console.log(chalk.dim("See HANDOFF.md landmine 48 for the typing-indicator analogue."));
  process.exit(1);
}

function resolveType(input: string): number | null {
  const lower = input.trim().toLowerCase();
  if (lower in TAPBACK_TYPES) return TAPBACK_TYPES[lower]!;
  const n = Number(input);
  if (Number.isInteger(n) && ((n >= 2000 && n <= 2005) || (n >= 3000 && n <= 3005))) {
    return n >= 3000 ? n - 1000 : n;
  }
  return null;
}
