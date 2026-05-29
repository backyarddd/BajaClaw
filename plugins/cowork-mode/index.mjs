// OpenClaw plugin entry for Cowork outcome mode. Registers a `cowork.run` tool.
import { planGoal, runOutcome } from "./flow.mjs";

export const tools = {
  "cowork.plan": {
    description: "Decompose a goal into an ordered, checkable plan.",
    run: ({ goal }) => planGoal(goal),
  },
  "cowork.run": {
    description: "Run a goal end-to-end and return a finished deliverable.",
    run: async ({ goal }, ctx) => runOutcome(goal, { execute: ctx?.execute, onProgress: ctx?.onProgress }),
  },
};

export default async function register(api) {
  if (api?.registerTool) {
    for (const [name, def] of Object.entries(tools)) {
      api.registerTool({ name, description: def.description, handler: def.run });
    }
  }
  return { id: "cowork-mode", tools: Object.keys(tools) };
}

export { planGoal, runOutcome };
