"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { ACTIVE_WORKSPACE_COOKIE, ACTIVE_WORKSPACE_COOKIE_MAX_AGE } from "./constants";

export interface WorkspaceSummary {
  id: string;
  name: string;
}

interface WorkspaceContextValue {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceSummary | null;
  /** Switch the active workspace: persists to a cookie + refreshes server data. */
  setActiveWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function persistActiveWorkspace(id: string | null): void {
  if (typeof document === "undefined") {
    return;
  }
  if (id) {
    document.cookie = `${ACTIVE_WORKSPACE_COOKIE}=${id}; path=/; max-age=${ACTIVE_WORKSPACE_COOKIE_MAX_AGE}; samesite=lax`;
  } else {
    document.cookie = `${ACTIVE_WORKSPACE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

export function WorkspaceProvider({
  workspaces,
  initialWorkspaceId,
  children,
}: {
  workspaces: WorkspaceSummary[];
  initialWorkspaceId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(initialWorkspaceId);

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      setActiveWorkspaceIdState(id);
      persistActiveWorkspace(id);
      // Re-run server components so SSR reads (layout, settings) reflect the switch.
      router.refresh();
    },
    [router],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
      setActiveWorkspaceId,
    }),
    [workspaces, activeWorkspaceId, setActiveWorkspaceId],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

export { ACTIVE_WORKSPACE_COOKIE } from "./constants";
