// Playwright global teardown: delete the seeded auth user, which cascades away
// the workspace and every workspace-scoped row created during the run.

import { existsSync } from "node:fs";

import { CONTEXT_PATH } from "./helpers/config";
import { deleteWorkspaceUser, loadContext } from "./helpers/supabase";

async function globalTeardown(): Promise<void> {
  if (!existsSync(CONTEXT_PATH)) {
    return;
  }
  try {
    const { userId } = loadContext();
    await deleteWorkspaceUser(userId);
  } catch (error) {
    // Teardown must never fail the run; log and move on.
    console.warn("e2e teardown: could not delete seed user —", (error as Error).message);
  }
}

export default globalTeardown;
