// Two-layer cache for the skills index.
//
// Layer 1: in-process LRU keyed by (profile, manifestHash, allowedToolsKey).
// Layer 2: on-disk snapshot at .skills_prompt_snapshot.json.
//
// On every getOrBuildIndex call we recompute the manifestHash (a cheap
// stat over visible SKILL.md files). If the hash matches an LRU entry,
// we reuse the cached rendered text. If not, we fall back to disk
// snapshot, then to a full rebuild.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { profileSkillIndexCachePath } from "../paths.js";
import { buildSkillsIndex, type SkillsIndex } from "./index-builder.js";

interface CacheEntry {
  profile: string;
  manifestHash: string;
  allowedToolsKey: string;
  index: SkillsIndex;
}

const lru: CacheEntry[] = [];
const LRU_MAX = 16;

export const _stats = (() => {
  let hits = 0;
  let misses = 0;
  return {
    hit() { hits++; },
    miss() { misses++; },
    get() { return { hits, misses }; },
    reset() { hits = 0; misses = 0; },
  };
})();

export function getOrBuildIndex(profile: string, allowedTools: string[] = []): SkillsIndex {
  const allowedKey = allowedTools.slice().sort().join(",");

  // Always rebuild a fresh probe to get the current manifest hash.
  // The build is cheap when nothing changed (no LLM, just file stats).
  const probe = buildSkillsIndex(profile, allowedTools);

  // Layer 1: in-process LRU
  const cached = lru.find(
    (e) => e.profile === profile && e.manifestHash === probe.manifestHash && e.allowedToolsKey === allowedKey,
  );
  if (cached) {
    _stats.hit();
    moveToFront(cached);
    return cached.index;
  }

  // Layer 2: on-disk snapshot
  const snapPath = profileSkillIndexCachePath(profile);
  if (existsSync(snapPath)) {
    try {
      const snap = JSON.parse(readFileSync(snapPath, "utf8")) as {
        manifestHash: string;
        rendered_index: string;
        generated_at: string;
        allowedToolsKey?: string;
      };
      if (snap.manifestHash === probe.manifestHash && snap.allowedToolsKey === allowedKey) {
        const index: SkillsIndex = {
          text: snap.rendered_index,
          skills: probe.skills,
          manifestHash: snap.manifestHash,
        };
        pushLru({ profile, manifestHash: snap.manifestHash, allowedToolsKey: allowedKey, index });
        _stats.hit();
        return index;
      }
    } catch { /* fall through */ }
  }

  // Layer 3: miss. Persist the snapshot we just built and cache.
  writeSnapshot(snapPath, probe, allowedKey);
  pushLru({ profile, manifestHash: probe.manifestHash, allowedToolsKey: allowedKey, index: probe });
  _stats.miss();
  return probe;
}

function moveToFront(entry: CacheEntry): void {
  const idx = lru.indexOf(entry);
  if (idx > 0) {
    lru.splice(idx, 1);
    lru.unshift(entry);
  }
}

function pushLru(entry: CacheEntry): void {
  lru.unshift(entry);
  while (lru.length > LRU_MAX) lru.pop();
}

function writeSnapshot(path: string, idx: SkillsIndex, allowedToolsKey: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    manifestHash: idx.manifestHash,
    rendered_index: idx.text,
    generated_at: new Date().toISOString(),
    allowedToolsKey,
  };
  writeFileSync(tmp, JSON.stringify(payload), "utf8");
  renameSync(tmp, path);
}

export function invalidate(profile: string): void {
  for (let i = lru.length - 1; i >= 0; i--) {
    if (lru[i]!.profile === profile) lru.splice(i, 1);
  }
}
