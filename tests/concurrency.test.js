import { test } from "node:test";
import assert from "node:assert/strict";

test("serialize: runs work in submit order on the same profile", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  const order = [];
  const a = serialize("p", async () => { await delay(20); order.push("a"); return "a"; });
  const b = serialize("p", async () => { order.push("b"); return "b"; });
  const c = serialize("p", async () => { order.push("c"); return "c"; });
  assert.equal(await a, "a");
  assert.equal(await b, "b");
  assert.equal(await c, "c");
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("serialize: different profiles do not block each other", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  let aRunning = false;
  let bStartedWhileARunning = false;
  const a = serialize("pa", async () => {
    aRunning = true;
    await delay(40);
    aRunning = false;
    return "a";
  });
  // Give a tick so a is in flight.
  await delay(5);
  const b = serialize("pb", async () => {
    bStartedWhileARunning = aRunning;
    return "b";
  });
  await Promise.all([a, b]);
  assert.equal(bStartedWhileARunning, true);
});

test("serialize: a rejected work item does not block subsequent work", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  const a = serialize("p2", async () => { throw new Error("boom"); });
  await assert.rejects(a, /boom/);
  // The queue head must be a settled promise after a rejection.
  const b = await serialize("p2", async () => "ok");
  assert.equal(b, "ok");
});

test("serialize: a HUNG work item does not permanently jam the queue (deadline)", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  // The hung work never resolves. Without a deadline, every subsequent
  // serialize() call would wait forever on the queue head.
  const hung = serialize("p3", () => new Promise(() => { /* never */ }), 50);
  // We don't await `hung` - the caller's promise is genuinely stuck.
  // What matters is that the NEXT submission can proceed past the
  // deadline.
  const start = Date.now();
  const next = serialize("p3", async () => "second", 50);
  const got = await next;
  const elapsed = Date.now() - start;
  assert.equal(got, "second");
  // Deadline was 50ms; allow generous slack for slow CI but it must
  // be way under any "infinite wait" threshold.
  assert.ok(elapsed < 1000, `expected to unblock fast, took ${elapsed}ms`);
  // The hung promise stays pending - we don't observe it to avoid
  // leaving an unhandled rejection. Suppress the dangling promise.
  hung.catch(() => {});
});

test("serialize: deadline fires only on actual hangs, not on normal runs", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  // 30ms deadline; work takes 5ms. The deadline must NOT pre-empt
  // normal work - it's a safety net, not a per-cycle timeout.
  const start = Date.now();
  const a = await serialize("p4", async () => { await delay(5); return "a"; }, 30);
  const b = await serialize("p4", async () => { await delay(5); return "b"; }, 30);
  const elapsed = Date.now() - start;
  assert.equal(a, "a");
  assert.equal(b, "b");
  // Sequential 5ms runs should sum near 10ms, not 30ms+30ms.
  assert.ok(elapsed < 80, `expected serialized fast runs, took ${elapsed}ms`);
});

test("serialize: caller still observes rejection from hung-then-rejected work", async () => {
  const { serialize, _resetQueues } = await import("../src/concurrency.ts");
  _resetQueues();
  // The work eventually rejects after the deadline. The caller's
  // promise must still surface that rejection - the deadline is for
  // the QUEUE HEAD, not for the caller's view of work().
  const slow = serialize("p5", async () => { await delay(40); throw new Error("late-fail"); }, 10);
  await assert.rejects(slow, /late-fail/);
});

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
