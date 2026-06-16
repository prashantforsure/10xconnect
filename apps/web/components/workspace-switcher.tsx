"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace/context";

export function WorkspaceSwitcher() {
  const { activeWorkspace, workspaces } = useWorkspace();
  const label =
    activeWorkspace?.name ?? (workspaces.length === 0 ? "No workspace" : "Select workspace");

  // Switching/CRUD arrives in Step 5; this is a read-only placeholder for now.
  return (
    <Button
      variant="outline"
      className="w-full justify-between"
      disabled
      title="Workspace management arrives in Step 5"
    >
      <span className="truncate">{label}</span>
      <ChevronsUpDown className="opacity-50" />
    </Button>
  );
}
