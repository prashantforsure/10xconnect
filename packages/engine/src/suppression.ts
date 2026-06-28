// do_not_contact (suppression / opt-out) — enforced in TWO places (CLAUDE.md
// §11): at ENROLLMENT (campaign-runner) and at SEND (dispatch), so a suppressed
// person is never contacted from ANY campaign. "not interested" / "unsubscribe"
// replies add the lead here (via the conversation pre-gate). Identifiers are
// matched case-insensitively on email and exactly on linkedin_url.

import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface LeadIdentifier {
  linkedin_url: string | null;
  email: string | null;
}

/** Is this lead on the workspace's do-not-contact list? */
export async function isLeadSuppressed(
  db: Kysely<DB>,
  workspaceId: string,
  lead: LeadIdentifier,
): Promise<boolean> {
  const { linkedin_url, email } = lead;
  if (!linkedin_url && !email) return false;
  const row = await db
    .selectFrom("do_not_contact")
    .select("id")
    .where("workspace_id", "=", workspaceId)
    .where((eb) => {
      const ors = [];
      if (email) ors.push(eb("email", "=", email));
      if (linkedin_url) ors.push(eb("linkedin_url", "=", linkedin_url));
      return eb.or(ors);
    })
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Add a lead to do_not_contact (idempotent). Called when a prospect opts out /
 * says they're not interested, so EVERY campaign honors it from then on.
 */
export async function addToDoNotContact(
  db: Kysely<DB>,
  workspaceId: string,
  lead: LeadIdentifier,
  reason: string,
): Promise<void> {
  if (!lead.linkedin_url && !lead.email) return;
  await db
    .insertInto("do_not_contact")
    .values({
      workspace_id: workspaceId,
      linkedin_url: lead.linkedin_url,
      email: lead.email,
      reason,
    })
    // Unique on (workspace, lower(email)) and (workspace, linkedin_url) — a repeat
    // opt-out is a harmless no-op.
    .onConflict((oc) => oc.doNothing())
    .execute();
}
