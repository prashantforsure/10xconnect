"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";

import { CreateWorkspaceModal } from "@/components/create-workspace-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  const label =
    activeWorkspace?.name ?? (workspaces.length === 0 ? "Create a workspace" : "Select workspace");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            <span className="truncate">{label}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[13.5rem]">
          {workspaces.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Workspaces
              </DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  onSelect={() => {
                    if (w.id !== activeWorkspaceId) {
                      setActiveWorkspaceId(w.id);
                    }
                  }}
                >
                  <Check
                    className={cn(w.id === activeWorkspaceId ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{w.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
