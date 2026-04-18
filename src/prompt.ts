// Tiny readline-based prompt helpers for the interactive setup wizard.
// No new dep - uses node:readline/promises.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export function isInteractive(): boolean {
  return !!stdin.isTTY && !!stdout.isTTY;
}

export async function ask(question: string, fallback?: string): Promise<string> {
  if (!isInteractive()) return fallback ?? "";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hint = fallback ? ` \x1b[90m[${fallback}]\x1b[0m` : "";
    const answer = (await rl.question(`${question}${hint} `)).trim();
    return answer || (fallback ?? "");
  } finally {
    rl.close();
  }
}

export async function askChoice(
  question: string,
  options: string[],
  fallback: string = options[0]!,
): Promise<string> {
  if (!isInteractive()) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const labels = options.map((o, i) => `${i + 1}. ${o}${o === fallback ? " \x1b[90m(default)\x1b[0m" : ""}`).join("\n  ");
    stdout.write(`${question}\n  ${labels}\n`);
    const raw = (await rl.question("choice: ")).trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!;
    // Allow typed-in free-form that matches.
    const match = options.find((o) => o.toLowerCase() === raw.toLowerCase());
    return match ?? fallback;
  } finally {
    rl.close();
  }
}

export async function askList(question: string, separator = ","): Promise<string[]> {
  const raw = await ask(`${question} \x1b[90m(comma-separated, blank to skip)\x1b[0m`);
  if (!raw) return [];
  return raw.split(separator).map((s) => s.trim()).filter(Boolean);
}

export function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; }
}
