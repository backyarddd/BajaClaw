import { test } from "node:test";
import assert from "node:assert/strict";

test("renderSoul: includes name and tone description", async () => {
  const { renderSoul } = await import("../src/persona.ts");
  const soul = renderSoul({
    agentName: "Juno",
    userName: "Alex",
    tone: "terse",
    timezone: "America/Los_Angeles",
    focus: "Inbox triage and daily briefings.",
    interests: ["stripe billing", "q3 hiring"],
    doNots: ["send email without approval"],
  });
  assert.match(soul, /# Juno/);
  assert.match(soul, /Alex/);
  assert.match(soul, /terse/);
  assert.match(soul, /America\/Los_Angeles/);
  assert.match(soul, /Inbox triage/);
  assert.match(soul, /stripe billing/);
  assert.match(soul, /send email without approval/);
});

test("renderSoul: agentName-only render is valid", async () => {
  const { renderSoul } = await import("../src/persona.ts");
  const soul = renderSoul({ agentName: "Baja" });
  assert.match(soul, /# Baja/);
  assert.match(soul, /I don't know their name yet/);
  assert.match(soul, /Tone: concise/);
});
