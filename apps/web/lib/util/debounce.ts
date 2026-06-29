// A tiny trailing-edge debouncer. Extracted from the campaign builder's autosave
// so the "don't save on every keystroke, save once after the user pauses" behavior
// is unit-testable (see debounce.test.ts). schedule() coalesces a burst of calls
// into a single deferred invocation; flush() runs it now; cancel() drops it.

export interface Debouncer {
  /** (Re)arm the timer — the latest call within `delayMs` wins, fn runs once after the pause. */
  schedule(): void;
  /** Cancel any pending timer and invoke fn immediately (e.g. on unmount / "Save now"). */
  flush(): void;
  /** Cancel any pending timer without invoking fn. */
  cancel(): void;
  /** True while a deferred invocation is armed. */
  isPending(): boolean;
}

export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    flush(): void {
      clear();
      fn();
    },
    cancel(): void {
      clear();
    },
    isPending(): boolean {
      return timer !== null;
    },
  };
}
