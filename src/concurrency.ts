// In-process cycle serialization. Ensures at most one cycle runs per
// profile within the same node process. Prevents the HTTP API from
// spawning parallel `claude` subprocesses under load - which would
// inflate backend usage and look a lot like automation abuse.
//
// Cross-process coordination (daemon vs manual CLI) is not done here -
// that would require a filesystem lock. In practice the daemon polls
// every 60s, CLI runs are rare, and the rate limiter is the backstop.
//
// Hang tolerance: when work() never settles (subprocess grandchildren
// keep stdout pipes open past execa's timeout, an MCP server deadlocks,
// etc), the queue head must still advance. Without `deadlineMs` a
// single stuck cycle would block every subsequent serialize() call
// for the lifetime of the process. Callers pass an upper bound
// (typically cycleTimeoutMs + a cleanup buffer); the queue advances
// after that even if work() is still running.

const queues = new Map<string, Promise<unknown>>();

export function serialize<T>(
  profile: string,
  work: () => Promise<T>,
  deadlineMs?: number,
): Promise<T> {
  const prev = queues.get(profile) ?? Promise.resolve();
  const next = prev.then(() => work());

  // What gets stored as the queue head must always settle - never
  // stay pending. .catch() only fires on rejection, so a true hang
  // (neither resolve nor reject) would leave the head pending forever
  // without the deadline race below.
  const settled = next.catch(() => undefined);
  const queueHead = deadlineMs && deadlineMs > 0
    ? Promise.race([settled, deadline(deadlineMs)])
    : settled;
  queues.set(profile, queueHead);

  return next;
}

function deadline(ms: number): Promise<undefined> {
  return new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), ms);
    // We deliberately DON'T unref the timer. unref'ing it lets the
    // process exit while the timer is pending, which Node 22's test
    // runner detects as "Promise resolution is still pending but the
    // event loop has already resolved" and cancels in-flight tests.
    // The cost of keeping the loop alive is at most `ms` (typically
    // tens to hundreds of ms) for one-shot CLI calls; long-lived
    // daemons aren't affected. The correctness benefit (deterministic
    // promise settlement) is worth that small wait.
  });
}

/** For tests + diagnostics. Resets the queue map. Never call from
 *  production code - mid-cycle reset would orphan running work. */
export function _resetQueues(): void {
  queues.clear();
}
