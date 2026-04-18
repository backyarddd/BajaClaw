// In-process cycle serialization. Ensures at most one cycle runs per
// profile within the same node process. Prevents the HTTP API from
// spawning parallel `claude` subprocesses under load - which would
// inflate backend usage and look a lot like automation abuse.
//
// Cross-process coordination (daemon vs manual CLI) is not done here -
// that would require a filesystem lock. In practice the daemon polls
// every 60s, CLI runs are rare, and the rate limiter is the backstop.

const queues = new Map<string, Promise<unknown>>();

export function serialize<T>(profile: string, work: () => Promise<T>): Promise<T> {
  const prev = queues.get(profile) ?? Promise.resolve();
  const next = prev.then(() => work());
  // Keep the chain alive even if one work item threw.
  queues.set(profile, next.catch(() => undefined));
  return next;
}
