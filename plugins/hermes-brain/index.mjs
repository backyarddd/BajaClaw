// OpenClaw plugin entry for the Hermes brain. Registers memory + skill tools.
// Degrades to a no-op registration if the OpenClaw SDK isn't present (so the
// store stays usable standalone and in tests).
import * as store from "./store.mjs";

export const tools = {
  "brain.remember": {
    description: "Persist a task outcome to long-term memory.",
    run: (args) => store.remember(args),
  },
  "brain.recall": {
    description: "Recall the most relevant past task outcomes for a query.",
    run: ({ query, limit }) => store.recall(query, { limit }),
  },
  "brain.synthesize_skills": {
    description: "Propose reusable skills learned from repeated successes.",
    run: (args) => store.synthesizeSkills(args),
  },
};

export default async function register(api) {
  // OpenClaw calls register(api). Wire tools if the API is available.
  if (api?.registerTool) {
    for (const [name, def] of Object.entries(tools)) {
      api.registerTool({ name, description: def.description, handler: def.run });
    }
  }
  return { id: "hermes-brain", tools: Object.keys(tools) };
}

export { store };
