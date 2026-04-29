// Plan mode: run a one-shot cycle that produces a structured plan
// instead of executing the task. The plan is persisted to the `plans`
// table (status=pending). The user reviews via the dashboard's Plans
// view (or `bajaclaw plan list`) and approves with `bajaclaw plan
// approve <id>`, which enqueues the task with the plan attached.
//
// The plan-only cycle uses an injected system prompt that hard-bans
// tool calls and mandates a markdown plan with sections: Goal,
// Steps, Risks, Success criteria. We don't try to constrain JSON
// shape - the agent's prose plan is what the user reviews.

import chalk from "chalk";
import { runCycle } from "../agent.js";
import { openDb } from "../db.js";

const PLAN_SYSTEM_PROMPT = `You are operating in PLAN MODE.

Output a written plan for the user-supplied task. Do NOT execute it.
Do NOT call tools. Reply with markdown only, in this exact shape:

## Goal
<one or two sentences restating the task in your own words>

## Steps
1. <first step>
2. <second step>
3. <...>

## Risks
- <risk 1, what could go wrong, mitigation>
- <risk 2>

## Success criteria
- <how the user will know this is done>
- <verifiable check the agent could run when executing>

Keep it short. 6-12 lines for steps. No code blocks unless absolutely
needed for clarity. The user will edit and approve before any
execution happens.`;

export interface PlanOpts {
  profile: string;
  task: string;
  modelOverride?: string;
}

export async function cmdPlan(opts: PlanOpts): Promise<void> {
  const db = openDb(opts.profile);
  let planText = "";
  let cycleId: number | null = null;
  try {
    const r = await runCycle({
      profile: opts.profile,
      task: `${opts.task}\n\nReply with the structured plan only. Do not execute.`,
      modelOverride: opts.modelOverride,
      sessionHistory: [],
    });
    cycleId = r.cycleId;
    if (!r.ok) {
      console.error(chalk.red(`plan: cycle failed: ${r.error ?? "unknown"}`));
      process.exit(1);
    }
    planText = r.text.trim();
  } finally { db.close(); }

  const db2 = openDb(opts.profile);
  let planId: number;
  try {
    const info = db2.prepare(
      "INSERT INTO plans(created_at, status, task, plan_text, cycle_id) VALUES(?,?,?,?,?)",
    ).run(new Date().toISOString(), "pending", opts.task, planText, cycleId);
    planId = Number(info.lastInsertRowid);
  } finally { db2.close(); }

  console.log(chalk.green(`✓ plan #${planId} ready for review`));
  console.log("");
  console.log(planText);
  console.log("");
  console.log(chalk.dim(`approve: bajaclaw plan approve ${planId}`));
  console.log(chalk.dim(`cancel:  bajaclaw plan cancel ${planId}`));
  console.log(chalk.dim(`dashboard: open http://localhost:7337/ -> Plans`));
}

export async function cmdPlanList(profile: string, opts: { all?: boolean } = {}): Promise<void> {
  const db = openDb(profile);
  try {
    const rows = db.prepare(
      opts.all
        ? "SELECT id, status, task, created_at, approved_at FROM plans ORDER BY id DESC LIMIT 50"
        : "SELECT id, status, task, created_at, approved_at FROM plans WHERE status='pending' ORDER BY id DESC LIMIT 50",
    ).all() as { id: number; status: string; task: string; created_at: string; approved_at: string | null }[];
    if (rows.length === 0) {
      console.log(chalk.dim("no plans"));
      return;
    }
    for (const r of rows) {
      console.log(`#${r.id}  ${chalk.dim(r.status.padEnd(8))} ${chalk.dim(r.created_at.slice(0, 19))}  ${r.task.slice(0, 80)}`);
    }
  } finally { db.close(); }
}

export async function cmdPlanShow(profile: string, id: number): Promise<void> {
  const db = openDb(profile);
  try {
    const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as { id: number; status: string; task: string; plan_text: string; created_at: string } | undefined;
    if (!row) { console.error(chalk.red(`plan #${id} not found`)); process.exit(1); }
    console.log(chalk.bold(`plan #${row.id}`) + chalk.dim(` (${row.status}, ${row.created_at.slice(0, 19)})`));
    console.log(chalk.dim("task:"));
    console.log(`  ${row.task}`);
    console.log("");
    console.log(row.plan_text);
  } finally { db.close(); }
}

export async function cmdPlanApprove(profile: string, id: number, opts: { edited?: string } = {}): Promise<void> {
  const db = openDb(profile);
  try {
    const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as { id: number; status: string; task: string; plan_text: string } | undefined;
    if (!row) { console.error(chalk.red(`plan #${id} not found`)); process.exit(1); }
    if (row.status !== "pending") {
      console.error(chalk.yellow(`plan #${id} already ${row.status}; nothing to do`));
      return;
    }
    const finalPlan = opts.edited ?? row.plan_text;
    const body = `${row.task}\n\n## Approved plan\n\n${finalPlan}\n\nExecute the plan above. Stop and report back if you hit anything that materially diverges.`;
    const info = db.prepare(
      "INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)",
    ).run(new Date().toISOString(), "high", "pending", body, `plan:${row.id}`);
    db.prepare("UPDATE plans SET status='approved', approved_at=?, approved_task_id=?, plan_text=? WHERE id=?").run(
      new Date().toISOString(), Number(info.lastInsertRowid), finalPlan, id,
    );
    const { wakeAgent } = await import("./daemon.js");
    wakeAgent(profile);
    console.log(chalk.green(`✓ plan #${id} approved; enqueued as task #${info.lastInsertRowid}`));
  } finally { db.close(); }
}

export async function cmdPlanCancel(profile: string, id: number): Promise<void> {
  const db = openDb(profile);
  try {
    const r = db.prepare("UPDATE plans SET status='cancelled' WHERE id = ? AND status = 'pending'").run(id);
    if (r.changes === 0) console.log(chalk.yellow(`plan #${id} not pending; nothing to do`));
    else console.log(chalk.green(`✓ plan #${id} cancelled`));
  } finally { db.close(); }
}
