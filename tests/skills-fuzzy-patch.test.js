import { test } from "node:test";
import assert from "node:assert/strict";

const MOD = "../dist/skills/fuzzy-patch.js";

test("fuzzyPatch: exact unique match replaces", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "line1\nfoo bar\nbaz\nline4";
  const r = fuzzyPatch(body, "foo bar\nbaz", "FOO BAR\nBAZ");
  assert.equal(r.ok, true);
  assert.match(r.body, /FOO BAR\nBAZ/);
});

test("fuzzyPatch: multiple exact matches reject", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "x\nx\nx\n";
  const r = fuzzyPatch(body, "x", "Y");
  assert.equal(r.ok, false);
  assert.match(r.reason, /ambig/i);
});

test("fuzzyPatch: whitespace tolerant when exact misses", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "alpha\n  beta  \ngamma";
  const r = fuzzyPatch(body, "alpha\nbeta\ngamma", "ALPHA\nBETA\nGAMMA");
  assert.equal(r.ok, true);
  assert.match(r.body, /ALPHA/);
});

test("fuzzyPatch: similarity match >=0.85", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "before\nthe quick brown fox jumps\nafter";
  const r = fuzzyPatch(body, "the quick brown fox jumped", "REPLACED");
  assert.equal(r.ok, true);
  assert.match(r.body, /REPLACED/);
});

test("fuzzyPatch: low similarity rejects", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "totally unrelated content here";
  const r = fuzzyPatch(body, "the quick brown fox jumps over", "REPLACED");
  assert.equal(r.ok, false);
});

test("fuzzyPatch: empty find rejects", async () => {
  const { fuzzyPatch } = await import(MOD);
  const r = fuzzyPatch("anything", "", "x");
  assert.equal(r.ok, false);
});

test("fuzzyPatch: empty replace deletes match", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "keep\nremove me\nkeep";
  const r = fuzzyPatch(body, "remove me\n", "");
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.body, /remove me/);
});

test("fuzzyPatch: returns range on success", async () => {
  const { fuzzyPatch } = await import(MOD);
  const body = "abc def ghi";
  const r = fuzzyPatch(body, "def", "DEF");
  assert.equal(r.ok, true);
  assert.equal(r.range.start, 4);
  assert.equal(r.range.end, 7);
});
