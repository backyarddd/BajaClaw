import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("detectPlatform returns a valid OS", async () => {
  const { detectPlatform } = await import("../dist/ensure.js");
  const plat = detectPlatform();
  assert.ok(["darwin", "linux", "win32"].includes(plat.os), `unexpected os: ${plat.os}`);
  assert.ok(Array.isArray(plat.managers));
});

test("listRecipes includes core tools", async () => {
  const { listRecipes } = await import("../dist/ensure.js");
  const names = listRecipes().map((r) => r.name);
  for (const n of ["gh", "vercel", "supabase", "ffmpeg", "yt-dlp", "tesseract", "poppler"]) {
    assert.ok(names.includes(n), `missing recipe: ${n}`);
  }
});

test("every recipe defines at least one install step for darwin or linux", async () => {
  const { listRecipes } = await import("../dist/ensure.js");
  for (const r of listRecipes()) {
    const hasMac = Array.isArray(r.steps.darwin) && r.steps.darwin.length > 0;
    const hasLinux = Array.isArray(r.steps.linux) && r.steps.linux.length > 0;
    assert.ok(hasMac || hasLinux, `${r.name}: no darwin or linux steps`);
  }
});

test("every recipe step has non-empty argv starting with a string", async () => {
  const { listRecipes } = await import("../dist/ensure.js");
  for (const r of listRecipes()) {
    for (const [os, steps] of Object.entries(r.steps)) {
      for (const s of steps ?? []) {
        assert.ok(Array.isArray(s.argv) && s.argv.length > 0, `${r.name}/${os}: empty argv`);
        assert.equal(typeof s.argv[0], "string");
      }
    }
  }
});

test("findRecipe returns undefined for unknown tool", async () => {
  const { findRecipe } = await import("../dist/ensure.js");
  assert.equal(findRecipe("definitely-not-a-real-tool"), undefined);
});

test("exit codes are distinct", async () => {
  const m = await import("../dist/ensure.js");
  const codes = new Set([
    m.EXIT_READY,
    m.EXIT_INSTALL_FAILED,
    m.EXIT_AUTH_PENDING,
    m.EXIT_UNSUPPORTED,
    m.EXIT_NO_MANAGER,
  ]);
  assert.equal(codes.size, 5);
});

test("ensureTool returns unsupported for a bogus name", async () => {
  const { ensureTool } = await import("../dist/ensure.js");
  const out = await ensureTool("bogus-tool-xyz", { quiet: true, checkOnly: true });
  assert.equal(out.status, "unsupported");
});

test("all 7 new skills are parseable and have triggers", () => {
  const skillsDir = join(__dirname, "..", "skills");
  const expected = ["github", "vercel", "supabase", "pr-review", "debug-methodology", "conventional-commits", "ocr-pdf"];
  const entries = readdirSync(skillsDir).filter((e) => {
    try { return statSync(join(skillsDir, e)).isDirectory(); } catch { return false; }
  });
  for (const name of expected) {
    assert.ok(entries.includes(name), `missing skill directory: ${name}`);
    const body = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    assert.match(body, /^---/, `${name}: no frontmatter`);
    assert.match(body, /name:\s*\S+/, `${name}: no name`);
    assert.match(body, /description:\s*\S+/, `${name}: no description`);
    assert.match(body, /triggers:/, `${name}: no triggers`);
  }
});

test("skills referencing 'bajaclaw ensure' document exit codes or setup", () => {
  const skillsDir = join(__dirname, "..", "skills");
  const toolSkills = ["github", "vercel", "supabase", "ocr-pdf"];
  for (const name of toolSkills) {
    const body = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    assert.match(body, /bajaclaw ensure/, `${name}: should call bajaclaw ensure`);
  }
});
