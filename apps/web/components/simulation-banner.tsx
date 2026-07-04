"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";

import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

interface WorkspaceView {
  id: string;
  effectiveSimulation?: boolean;
}

/**
 * Global "Simulation mode" banner. When the active workspace runs in test/simulation
 * mode, the dispatch engine records everything but sends NOTHING real — so surface it
 * prominently: otherwise a developer sees campaigns "run" with no LinkedIn activity and
 * assumes something is broken. Fail-silent (renders nothing on error).
 */
export function SimulationBanner() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [on, setOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!activeWorkspaceId) {
      setOn(false);
      return;
    }
    void api
      .request<WorkspaceView[]>("/workspaces")
      .then((rows) => {
        if (!cancelled) {
          setOn(rows.find((w) => w.id === activeWorkspaceId)?.effectiveSimulation === true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOn(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, activeWorkspaceId]);

  if (!on) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-warning/[0.13] px-4 py-2 text-[12px] font-medium text-warning lg:px-7">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        Simulation mode is on — campaigns run end-to-end but <strong>no real messages are sent</strong>. Turn it off in
        Settings → General to send for real.
      </span>
    </div>
  );
}
