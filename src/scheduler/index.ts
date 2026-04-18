import { platform } from "node:os";
// Daemon poll interval bumped from 30s to 60s in v0.7.0 for token economy.
import type { ScheduleEntry } from "../types.js";
import * as launchd from "./launchd.js";
import * as systemd from "./systemd.js";
import * as cron from "./cron.js";
import * as schtasks from "./schtasks.js";

export interface SchedulerAdapter {
  install(profile: string, label: string, cronExpr: string, command: string[]): Promise<void>;
  uninstall(profile: string, label: string): Promise<void>;
  list(profile: string): Promise<ScheduleEntry[]>;
}

export function pickAdapter(): SchedulerAdapter {
  const plat = platform();
  if (plat === "darwin") return launchd;
  if (plat === "win32") return schtasks;
  // Prefer systemd user units; fall back to crontab.
  return systemd.available() ? systemd : cron;
}
