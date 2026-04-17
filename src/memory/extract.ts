import type { DB } from "../db.js";
import { runOnce } from "../claude.js";
import { insertMemory } from "./recall.js";
import type { AgentConfig } from "../types.js";

const EXTRACT_PROMPT = `You are a post-cycle memory extractor. From the cycle below, output 0-5 durable facts worth remembering across future sessions. Return strict JSON only: {"memories":[{"kind":"fact|decision|preference|todo|reference","content":"one sentence"}]} . Skip transient status, skip anything obvious from code.

<task>
{{TASK}}
</task>

<response>
{{RESPONSE}}
</response>`;

export async function extract(
  db: DB,
  cycleId: number,
  task: string,
  response: string,
  cfg: AgentConfig,
): Promise<number> {
  const prompt = EXTRACT_PROMPT
    .replace("{{TASK}}", task.slice(0, 2000))
    .replace("{{RESPONSE}}", response.slice(0, 6000));

  const r = await runOnce(prompt, {
    model: "claude-haiku-4-5",
    effort: "low",
    maxTurns: 1,
    printMode: true,
    disallowedTools: ["Bash", "Write", "Edit", "Read"],
  });

  if (!r.ok || !r.text) return 0;

  const json = firstJson(r.text);
  if (!json) return 0;

  const arr = Array.isArray(json.memories) ? json.memories : [];
  let count = 0;
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    const content = String((m as Record<string, unknown>).content ?? "").trim();
    const kind = String((m as Record<string, unknown>).kind ?? "fact").trim();
    if (!content) continue;
    insertMemory(db, { kind, content, source: "cycle", source_cycle_id: cycleId });
    count++;
  }
  return count;
}

function firstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
