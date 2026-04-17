import { existsSync } from "node:fs";
import { platform } from "node:os";
import { claudeHome, claudeDesktopConfigPath, bajaclawHome } from "./paths.js";
import { findClaudeBinary, claudeVersion } from "./claude.js";
import Database from "better-sqlite3";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runHealth(): Promise<Check[]> {
  const out: Check[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  out.push({
    name: "node",
    ok: nodeMajor >= 20,
    detail: `v${process.versions.node} (need >= 20)`,
  });

  const bin = await findClaudeBinary();
  out.push({ name: "cli backend", ok: !!bin, detail: bin ?? "`claude` not found in PATH" });

  if (bin) {
    const v = await claudeVersion();
    // The backend prints its own brand in --version; show only the semver prefix.
    const semver = v ? (v.match(/\d+\.\d+\.\d+\S*/) ?? [null])[0] : null;
    out.push({ name: "cli version", ok: !!v, detail: semver ?? v ?? "unable to read version" });
  }

  out.push({ name: "cli state dir", ok: existsSync(claudeHome()), detail: claudeHome() });
  out.push({ name: "bajaclaw home", ok: true, detail: bajaclawHome() });

  const desk = claudeDesktopConfigPath();
  out.push({ name: "desktop mcp config", ok: existsSync(desk), detail: desk });

  try {
    const db = new Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(a);");
    db.close();
    out.push({ name: "sqlite + FTS5", ok: true, detail: "ok" });
  } catch (e) {
    out.push({ name: "sqlite + FTS5", ok: false, detail: (e as Error).message });
  }

  out.push({ name: "platform", ok: true, detail: platform() });
  return out;
}
