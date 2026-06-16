"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface WorkspaceSummary {
  id: string;
  name: string;
}

interface WorkspaceContextValue {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspaces,
  initialWorkspaceId,
  children,
}: {
  workspaces: WorkspaceSummary[];
  initialWorkspaceId: string | null;
  children: ReactNode;
}) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(initialWorkspaceId);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
      setActiveWorkspaceId,
    }),
    [workspaces, activeWorkspaceId],
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
