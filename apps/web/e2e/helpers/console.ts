// Collect real browser console errors + uncaught page errors for a page, so a
// spec can assert a surface renders cleanly. Known dev-server / browser noise is
// filtered so the assertion flags only genuine app errors.

import type { Page } from "@playwright/test";

const BENIGN = [
  /favicon\.ico/i,
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
  /\[Fast Refresh\]/i,
  /the server responded with a status of 401/i, // pre-auth probe on some routes
];

/**
 * Start capturing console errors on `page`. Returns a getter for the collected
 * (non-benign) messages. Attach BEFORE the first navigation.
 */
export function trackConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") {
      return;
    }
    const text = msg.text();
    if (!BENIGN.some((re) => re.test(text))) {
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return () => [...errors];
}
