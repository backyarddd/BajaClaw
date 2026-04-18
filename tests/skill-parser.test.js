import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Light smoke: ensure built-in skills parse - all three include triggers/description.
test("built-in skill frontmatters parse", async () => {
  const skillsDir = join(__dirname, "..", "skills");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const entries = readdirSync(skillsDir).filter((e) => {
    const full = join(skillsDir, e);
    try { return statSync(full).isDirectory(); } catch { return false; }
  });
  assert.ok(entries.includes("daily-briefing"));
  assert.ok(entries.includes("email-triage"));
  assert.ok(entries.includes("web-research"));
  for (const name of entries) {
    const body = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    assert.match(body, /^---/);
    assert.match(body, /name:\s*\S+/);
    assert.match(body, /description:\s*\S+/);
  }
});

const OPENCLAW_SAMPLE = `---
name: sonoscli
description: Control Sonos speakers.
homepage: https://sonoscli.sh
version: 1.0.0
metadata:
  clawdbot:
    emoji: "🔊"
    requires:
      bins: [sonos]
    install:
      - kind: go
        module: github.com/steipete/sonoscli/cmd/sonos@latest
        bins: [sonos]
        label: Install sonoscli (go)
---

# Sonos CLI
`;

const HERMES_SAMPLE = `---
name: arxiv
description: Search arXiv from the shell.
version: 1.0.0
author: nous
license: MIT
platforms: [macos, linux]
required_environment_variables:
  - name: ARXIV_API_KEY
    prompt: "Enter your arXiv API key"
metadata:
  hermes:
    tags: [Research, arXiv, Academic]
    requires_tools: [web_search]
    fallback_for_tools: [deep_research]
    related_skills: [semantic-scholar]
---

# arXiv search
`;

test("parseSkill: openclaw-origin detection and field normalization", async () => {
  const { parseSkill } = await import("../dist/skills/loader.js");
  const parsed = parseSkill(OPENCLAW_SAMPLE, "/tmp/sonoscli", "bajaclaw-user");
  assert.ok(parsed);
  assert.equal(parsed.origin, "openclaw");
  assert.equal(parsed.name, "sonoscli");
  assert.deepEqual(parsed.requiredBins, ["sonos"]);
  assert.equal(parsed.homepage, "https://sonoscli.sh");
  assert.equal(parsed.emoji, "🔊");
  assert.ok(parsed.install);
  assert.equal(parsed.install[0].kind, "go");
  assert.equal(parsed.install[0].module, "github.com/steipete/sonoscli/cmd/sonos@latest");
});

test("parseSkill: hermes-origin detection and field normalization", async () => {
  const { parseSkill } = await import("../dist/skills/loader.js");
  const parsed = parseSkill(HERMES_SAMPLE, "/tmp/arxiv", "bajaclaw-user");
  assert.ok(parsed);
  assert.equal(parsed.origin, "hermes");
  assert.equal(parsed.name, "arxiv");
  assert.deepEqual(parsed.platforms, ["macos", "linux"]);
  assert.deepEqual(parsed.tags, ["Research", "arXiv", "Academic"]);
  assert.deepEqual(parsed.requiresTools, ["web_search"]);
  assert.deepEqual(parsed.fallbackForTools, ["deep_research"]);
  assert.deepEqual(parsed.related, ["semantic-scholar"]);
  assert.deepEqual(parsed.requiredEnv, ["ARXIV_API_KEY"]);
});

test("parseSkill: bajaclaw-origin when no foreign metadata block", async () => {
  const { parseSkill } = await import("../dist/skills/loader.js");
  const body = `---
name: hello
description: test
triggers: [hi, hello]
effort: low
---

body`;
  const parsed = parseSkill(body, "/tmp/hello", "bajaclaw-user");
  assert.equal(parsed.origin, "bajaclaw");
  assert.deepEqual(parsed.triggers, ["hi", "hello"]);
  assert.equal(parsed.effort, "low");
});

test("matchSkills: fallback_for_tools hides skill when a listed tool is present", async () => {
  const { matchSkills } = await import("../dist/skills/matcher.js");
  const skill = {
    name: "ddg-search",
    description: "duckduckgo fallback",
    body: "",
    path: "/tmp/ddg",
    scope: "bajaclaw-user",
    origin: "hermes",
    triggers: ["search"],
    fallbackForTools: ["web_search"],
  };
  const activeWhenMissing = matchSkills([skill], "search cats", 3, { allowedTools: ["Bash", "Read"] });
  assert.equal(activeWhenMissing.length, 1);
  const hiddenWhenPresent = matchSkills([skill], "search cats", 3, { allowedTools: ["Bash", "web_search"] });
  assert.equal(hiddenWhenPresent.length, 0);
});

test("matchSkills: tags contribute to score", async () => {
  const { matchSkills } = await import("../dist/skills/matcher.js");
  const tagged = {
    name: "a", description: "x", body: "", path: "/a", scope: "bajaclaw-user",
    origin: "hermes", tags: ["astronomy"],
  };
  const plain = {
    name: "b", description: "x", body: "", path: "/b", scope: "bajaclaw-user",
    origin: "bajaclaw",
  };
  const matched = matchSkills([tagged, plain], "show me some astronomy data", 3);
  assert.equal(matched[0].name, "a");
});
