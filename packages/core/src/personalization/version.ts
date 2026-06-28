// Prompt-version hash (Phase 5). A stable fingerprint of a node's message body
// (text + variable chips + AI prompt). The preview cache is keyed by
// (node_id, contact_id, prompt_version): editing the prompt changes the body →
// a new version → the old cached output is no longer read (invalidation on edit).

import type { MessageBody } from "../composer/segments";

function djb2(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 33) ^ value.charCodeAt(i);
  }
  return h >>> 0;
}

/** Deterministic version string for a structured message body. */
export function promptVersion(body: MessageBody): string {
  return djb2(JSON.stringify(body.segments ?? [])).toString(36);
}
