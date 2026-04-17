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
  out.push({ name: "claude CLI", ok: !!bin, detail: bin ?? "not found in PATH" });

  if (bin) {
    const v = await claudeVersion();
    out.push({ name: "claude version", ok: !!v, detail: v ?? "unable to read version" });
  }

  out.push({ name: "claude home", ok: existsSync(claudeHome()), detail: claudeHome() });
  out.push({ name: "bajaclaw home", ok: true, detail: bajaclawHome() });

  const desk = claudeDesktopConfigPath();
  out.push({ name: "claude desktop config", ok: existsSync(desk), detail: desk });

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
