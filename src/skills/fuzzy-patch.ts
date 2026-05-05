// Fuzzy-match patcher for skill_manage(action="patch").
// Tries exact substring, then whitespace-normalized, then character-level
// similarity (>=0.85). Multiple matches at any phase reject as ambiguous.

export interface FuzzyPatchResult {
  ok: boolean;
  body: string;
  reason?: string;
  range?: { start: number; end: number };
}

const SIMILARITY_THRESHOLD = 0.85;

export function fuzzyPatch(body: string, find: string, replace: string): FuzzyPatchResult {
  if (!find) return { ok: false, body, reason: "empty find" };

  // Phase 1: exact substring match
  const exact = findAllSubstrings(body, find);
  if (exact.length === 1) {
    const start = exact[0]!;
    const end = start + find.length;
    return {
      ok: true,
      body: body.slice(0, start) + replace + body.slice(end),
      range: { start, end },
    };
  }
  if (exact.length > 1) {
    return { ok: false, body, reason: `${exact.length} exact matches; ambiguous, narrow context` };
  }

  // Phase 2: whitespace-normalized match
  const normFind = normalizeWs(find);
  const wsRanges = findNormalizedRanges(body, normFind);
  if (wsRanges.length === 1) {
    const { start, end } = wsRanges[0]!;
    return {
      ok: true,
      body: body.slice(0, start) + replace + body.slice(end),
      range: { start, end },
    };
  }
  if (wsRanges.length > 1) {
    return { ok: false, body, reason: "multiple whitespace-normalized matches" };
  }

  // Phase 3: similarity over line-block windows
  const sim = bestSimilarityRange(body, find, SIMILARITY_THRESHOLD);
  if (sim) {
    const { start, end } = sim;
    return {
      ok: true,
      body: body.slice(0, start) + replace + body.slice(end),
      range: { start, end },
    };
  }
  return { ok: false, body, reason: "no match (exact, whitespace, or similarity)" };
}

function findAllSubstrings(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;
    out.push(idx);
    i = idx + 1;
  }
  return out;
}

function normalizeWs(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// Find all character ranges in haystack whose normalized form equals normNeedle.
function findNormalizedRanges(haystack: string, normNeedle: string): { start: number; end: number }[] {
  if (!normNeedle) return [];
  const out: { start: number; end: number }[] = [];
  const minLen = Math.max(1, Math.floor(normNeedle.length * 0.5));
  const maxLen = Math.ceil(normNeedle.length * 2.5);
  for (let start = 0; start < haystack.length; start++) {
    let matched = false;
    for (let len = minLen; len <= maxLen && start + len <= haystack.length; len++) {
      const slice = haystack.slice(start, start + len);
      if (normalizeWs(slice) === normNeedle) {
        out.push({ start, end: start + len });
        start = start + len - 1;
        matched = true;
        break;
      }
    }
    if (!matched && out.length > 1) return out;
  }
  return out;
}

// Best line-block window with similarity >= threshold. Window size = needle line count +/- 1.
function bestSimilarityRange(
  haystack: string,
  needle: string,
  threshold: number,
): { start: number; end: number } | null {
  const lines = haystack.split("\n");
  const needleLines = Math.max(1, needle.split("\n").length);
  const lineStarts: number[] = [0];
  let acc = 0;
  for (const ln of lines) {
    acc += ln.length + 1;
    lineStarts.push(acc);
  }
  let best: { start: number; end: number; score: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    for (const w of [needleLines - 1, needleLines, needleLines + 1]) {
      if (w <= 0 || i + w > lines.length) continue;
      const start = lineStarts[i]!;
      const endLine = i + w;
      const end = endLine >= lines.length ? haystack.length : lineStarts[endLine]! - 1;
      if (end <= start) continue;
      const slice = haystack.slice(start, end);
      const score = similarity(slice, needle);
      if (score >= threshold && (!best || score > best.score)) {
        best = { start, end, score };
      }
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - dist / max;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}
