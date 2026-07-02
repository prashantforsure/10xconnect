import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTotp } from "./totp";

// RFC 6238 Appendix B reference vector (SHA-1). The shared secret is the ASCII
// string "12345678901234567890", whose base32 encoding is the value below. At
// Unix time 59s (counter 1) the 8-digit TOTP is 94287082 → 6-digit 287082.
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("generateTotp matches the RFC 6238 SHA-1 reference vector", () => {
  assert.equal(generateTotp(RFC_SECRET_BASE32, { timeMs: 59_000, digits: 8 }), "94287082");
  assert.equal(generateTotp(RFC_SECRET_BASE32, { timeMs: 59_000 }), "287082"); // default 6 digits
});

test("generateTotp is stable within a step and tolerates lowercase/spacing", () => {
  // Both timestamps fall in the same 30s window [1111111110s, 1111111140s).
  const a = generateTotp(RFC_SECRET_BASE32, { timeMs: 1_111_111_110_000 });
  const b = generateTotp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", { timeMs: 1_111_111_139_000 });
  assert.equal(a, b); // same window, case/space-insensitive base32
  assert.match(a, /^\d{6}$/);
});
