// Daily self-update watcher. Diffs upstreams and writes an approve-to-merge
// proposal. NEVER auto-merges. Sources:
//   - openclaw/openclaw         (GitHub releases)  -> our core dependency
//   - NousResearch/hermes-agent (GitHub releases)  -> brain ideas
//   - Claude Cowork             (Anthropic page)   -> closed source: snapshot+diff
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const HOME = homedir();
const DIR = process.env.BAJACLAW_HOME || join(HOME, ".bajaclaw");
const STATE = join(DIR, "update-state.json");
const UPDATES_DIR = join(DIR, "updates");

const UA = { "user-agent": "bajaclaw-self-updater", accept: "application/vnd.github+json" };

function loadState() {
  if (!existsSync(STATE)) return { seen: {}, lastRun: null };
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { seen: {}, lastRun: null }; }
}
function saveState(s) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

async function ghLatest(repo) {
  // Prefer releases; fall back to tags so repos without GitHub Releases still work.
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: UA });
    if (r.ok) {
      const j = await r.json();
      return { repo, version: j.tag_name, name: j.name, url: j.html_url, notes: (j.body || "").slice(0, 4000) };
    }
  } catch {}
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers: UA });
    if (r.ok) {
      const j = await r.json();
      if (j[0]) return { repo, version: j[0].name, name: j[0].name, url: `https://github.com/${repo}/releases/tag/${j[0].name}`, notes: "(no release notes; tag only)" };
    }
  } catch {}
  return { repo, version: null, error: "unreachable or rate-limited" };
}

async function coworkSnapshot(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "bajaclaw-self-updater" } });
    if (!r.ok) return { url, error: `http ${r.status}` };
    const text = await r.text();
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    return { url, hash, bytes: text.length };
  } catch (e) {
    return { url, error: String(e?.message || e) };
  }
}

export async function check(cfg, { write = true } = {}) {
  const watch = cfg.selfUpdate.watch;
  const state = loadState();
  const [openclaw, hermes, cowork] = await Promise.all([
    ghLatest(watch.openclaw),
    ghLatest(watch.hermes),
    coworkSnapshot(watch.coworkChangelog),
  ]);

  const findings = [];
  const consider = (key, cur, label, extra = {}) => {
    const prev = state.seen[key];
    const changed = cur != null && cur !== prev;
    if (changed) findings.push({ key, label, from: prev || "(none)", to: cur, ...extra });
    state.seen[key] = cur ?? prev;
  };

  consider("openclaw.release", openclaw.version, "OpenClaw (inspiration)", { url: openclaw.url, notes: openclaw.notes });
  consider("hermes.release", hermes.version, "Hermes Agent (inspiration)", { url: hermes.url, notes: hermes.notes });
  consider("cowork.snapshot", cowork.hash, "Claude Cowork page (closed source)", { url: cowork.url });

  state.lastRun = new Date().toISOString();
  if (write) saveState(state);

  const proposal = renderProposal({ findings, openclaw, hermes, cowork, mode: cfg.selfUpdate.mode });
  let proposalPath = null;
  if (write && findings.length) {
    if (!existsSync(UPDATES_DIR)) mkdirSync(UPDATES_DIR, { recursive: true });
    proposalPath = join(UPDATES_DIR, `proposal-${state.lastRun.slice(0, 10)}.md`);
    writeFileSync(proposalPath, proposal);
  }
  return { findings, proposal, proposalPath, raw: { openclaw, hermes, cowork } };
}

function renderProposal({ findings, mode }) {
  const lines = [];
  lines.push(`# BajaClaw upstream update proposal`);
  lines.push(`Generated: ${new Date().toISOString()}  ·  mode: ${mode}`);
  lines.push("");
  if (!findings.length) {
    lines.push("No upstream changes since last check. Nothing to do.");
    return lines.join("\n");
  }
  lines.push(`${findings.length} change(s) detected. Review and approve to apply.`);
  lines.push("");
  for (const f of findings) {
    lines.push(`## ${f.label}`);
    lines.push(`- ${f.from} → **${f.to}**`);
    if (f.url) lines.push(`- ${f.url}`);
    if (f.notes) { lines.push("", "```", f.notes.trim(), "```"); }
    lines.push("");
  }
  lines.push("## Suggested action");
  lines.push("- BajaClaw is standalone; these are inspiration sources, not dependencies.");
  lines.push("- Port any worthwhile feature natively into src/ or plugins/, then `bajaclaw restart`.");
  lines.push("- This file is a proposal only. Nothing was changed automatically.");
  return lines.join("\n");
}
