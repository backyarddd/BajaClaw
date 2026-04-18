// Persona state: types + pure rendering. File I/O lives in persona-io.ts
// so this module stays pure and easy to unit-test.

export interface Persona {
  agentName: string;         // what the agent calls itself (identity)
  userName?: string;         // what the agent should call the user
  tone?: "casual" | "concise" | "formal" | "friendly" | "playful" | "terse";
  timezone?: string;         // IANA tz, e.g. "America/Los_Angeles"
  focus?: string;            // primary purpose, 1-2 sentences
  interests?: string[];      // topics the agent should know about
  doNots?: string[];         // things the agent shouldn't do (hard constraints)
  createdAt?: string;
}

export const TONE_OPTIONS: Persona["tone"][] = ["concise", "casual", "friendly", "formal", "playful", "terse"];

// Render the persona into SOUL.md. The cycle loop reads SOUL.md verbatim
// and prepends it to the prompt as the identity block.
export function renderSoul(p: Persona): string {
  const lines: string[] = [];
  lines.push(`# ${p.agentName}`);
  lines.push("");
  if (p.focus) lines.push(p.focus);

  lines.push("");
  lines.push("## Who I'm talking to");
  if (p.userName) lines.push(`- Their name is ${p.userName}. Address them by name when appropriate.`);
  else lines.push(`- I don't know their name yet. If it matters, ask.`);
  if (p.timezone) lines.push(`- Their timezone is ${p.timezone}. Interpret "today", "tomorrow", and times in that zone.`);

  lines.push("");
  lines.push("## Voice");
  lines.push(`- Tone: ${p.tone ?? "concise"}.`);
  lines.push(`- ${toneDescription(p.tone ?? "concise")}`);

  if (p.interests && p.interests.length > 0) {
    lines.push("");
    lines.push("## What I care about");
    for (const i of p.interests) lines.push(`- ${i}`);
  }

  if (p.doNots && p.doNots.length > 0) {
    lines.push("");
    lines.push("## Hard rules");
    for (const d of p.doNots) lines.push(`- Don't ${d}`);
  }

  lines.push("");
  lines.push("## Identity principles");
  lines.push(`- I am ${p.agentName}. I maintain this identity across cycles.`);
  lines.push(`- I work for the user — I am not a chatbot. Produce artifacts, not filler.`);
  lines.push(`- When I don't know something, I say so and stop. No placeholder data.`);

  return lines.join("\n") + "\n";
}

function toneDescription(tone: string): string {
  switch (tone) {
    case "casual":   return "Speak informally. Contractions welcome. Plain English, no jargon.";
    case "concise":  return "Keep it tight. Short sentences. Ship the answer; skip the preamble.";
    case "formal":   return "Speak professionally. Complete sentences. Precise vocabulary.";
    case "friendly": return "Warm and conversational. It's fine to acknowledge feelings.";
    case "playful":  return "Light and witty — but useful first, witty second.";
    case "terse":    return "Minimum words. One-line answers when possible.";
    default:         return "Clear and direct.";
  }
}
