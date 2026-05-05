// Path validation for skill_manage write_file / remove_file.
// Restricts agent file writes to a whitelist of subdirs under a skill dir.

import { resolve, isAbsolute, relative, sep } from "node:path";

const ALLOWED_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

export interface ValidatedPath {
  ok: boolean;
  absolute?: string;
  reason?: string;
}

export function validateSkillSubpath(skillDir: string, rel: string): ValidatedPath {
  if (!rel || typeof rel !== "string") return { ok: false, reason: "empty path" };
  if (isAbsolute(rel)) return { ok: false, reason: "absolute paths rejected" };
  if (rel.includes("\0")) return { ok: false, reason: "null byte" };

  // Always split on both separators so input is normalized regardless of host.
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: "path must be <subdir>/<file>" };
  if (parts.includes("..")) return { ok: false, reason: "parent traversal rejected" };
  if (!ALLOWED_SUBDIRS.has(parts[0]!)) {
    return {
      ok: false,
      reason: `subdir must be one of: ${Array.from(ALLOWED_SUBDIRS).sort().join(", ")}`,
    };
  }

  const absolute = resolve(skillDir, rel);
  const skillResolved = resolve(skillDir);
  // Cross-platform containment check: path.relative returns "" or
  // <subpath> when the target is inside the dir, and a string starting
  // with ".." or an absolute path when it isn't. Works on both POSIX
  // and Windows separators.
  const inside = relative(skillResolved, absolute);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    if (inside !== "" && (inside.startsWith("..") || isAbsolute(inside))) {
      return { ok: false, reason: "path resolves outside skill dir" };
    }
  }
  // Sanity on the leading sep just in case.
  if (!absolute.startsWith(skillResolved + sep) && absolute !== skillResolved) {
    return { ok: false, reason: "path resolves outside skill dir" };
  }
  return { ok: true, absolute };
}
