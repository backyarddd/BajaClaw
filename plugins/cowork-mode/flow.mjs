// Cowork outcome mode (concept-replica of Anthropic Claude Cowork).
// Give it a goal; it plans, executes across tools/files, reports progress, and
// returns a finished deliverable. The executor is injected so it works with the
// OpenClaw agent in production and a deterministic stub in tests.

export function planGoal(goal) {
  // Minimal planner: decompose a goal into ordered, checkable steps.
  const g = String(goal || "").trim();
  const steps = [
    { id: 1, title: `Understand the goal`, detail: g },
    { id: 2, title: `Gather inputs / context`, detail: `Find files, data, and tools relevant to: ${g}` },
    { id: 3, title: `Produce the deliverable`, detail: `Do the work for: ${g}` },
    { id: 4, title: `Verify the result`, detail: `Check the deliverable satisfies: ${g}` },
  ];
  return { goal: g, steps };
}

export async function runOutcome(goal, { execute, onProgress } = {}) {
  const plan = planGoal(goal);
  const exec = execute || (async (step) => ({ ok: true, note: `(stub) did "${step.title}"` }));
  const results = [];
  for (const step of plan.steps) {
    onProgress?.({ phase: "step", step });
    const r = await exec(step, { plan, results });
    results.push({ step, result: r });
    onProgress?.({ phase: "step-done", step, result: r });
    if (r && r.ok === false) {
      return { goal: plan.goal, status: "blocked", at: step.id, plan, results,
        deliverable: null, reason: r.reason || "step failed" };
    }
  }
  const deliverable = results.map((r) => `- ${r.step.title}: ${r.result?.note ?? "done"}`).join("\n");
  onProgress?.({ phase: "complete" });
  return { goal: plan.goal, status: "complete", plan, results, deliverable };
}
