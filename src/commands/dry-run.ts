import { runStart } from "./start.js";
export async function runDryRun(profile: string, task?: string): Promise<void> {
  return runStart({ profile, task, dryRun: true });
}
