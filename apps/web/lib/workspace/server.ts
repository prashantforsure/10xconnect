import { cookies } from "next/headers";

import { ACTIVE_WORKSPACE_COOKIE } from "./constants";

/**
 * Resolve the active workspace id for SSR: the cookie selection if it is still
 * one the user belongs to, otherwise the first workspace (oldest). Returns null
 * when the user has no workspaces.
 */
export async function resolveActiveWorkspaceId(workspaceIds: string[]): Promise<string | null> {
  const store = await cookies();
  const cookieId = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (cookieId && workspaceIds.includes(cookieId)) {
    return cookieId;
  }
  return workspaceIds[0] ?? null;
}
