import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createDebouncer } from "./debounce";

// The builder autosave (BATCH 6 item 1.4): assert it actually DEBOUNCES — a burst
// of edits collapses to ONE save after the pause, not one save per keystroke.

test("schedule() coalesces a burst into a single trailing call", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const d = createDebouncer(() => {
    calls += 1;
  }, 1200);

  // Simulate 5 rapid "keystrokes" well within the debounce window.
  for (let i = 0; i < 5; i += 1) {
    d.schedule();
    t.mock.timers.tick(100); // 100ms between keystrokes (< 1200ms window)
  }
  assert.equal(calls, 0, "must NOT save on every keystroke");
  assert.equal(d.isPending(), true);

  // After the user pauses past the window, exactly one save fires.
  t.mock.timers.tick(1200);
  assert.equal(calls, 1, "exactly one debounced save after the pause");
  assert.equal(d.isPending(), false);
});

test("a second burst after the first save schedules another single save", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const d = createDebouncer(() => {
    calls += 1;
  }, 1000);

  d.schedule();
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);

  d.schedule();
  d.schedule();
  t.mock.timers.tick(1000);
  assert.equal(calls, 2, "second burst → one more save");
});

test("flush() saves immediately and cancels the pending timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const d = createDebouncer(() => {
    calls += 1;
  }, 1000);

  d.schedule();
  d.flush();
  assert.equal(calls, 1, "flush runs fn now");
  assert.equal(d.isPending(), false);

  // The previously-armed timer must NOT also fire (no double-save).
  t.mock.timers.tick(2000);
  assert.equal(calls, 1, "no leftover timer fires after flush");
});

test("cancel() drops a pending save without invoking fn", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const d = createDebouncer(() => {
    calls += 1;
  }, 1000);

  d.schedule();
  d.cancel();
  t.mock.timers.tick(2000);
  assert.equal(calls, 0);
  assert.equal(d.isPending(), false);
});

mock.reset();
