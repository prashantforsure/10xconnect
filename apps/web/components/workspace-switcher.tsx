"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";

import { CreateWorkspaceModal } from "@/components/create-workspace-modal";
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
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-[10px] border border-border bg-[hsl(45_22%_8.5%)] px-[11px] py-[9px] text-left transition-colors hover:bg-accent"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-success/15 font-display text-[10px] font-bold text-success">
              {(activeWorkspace?.name ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-foreground">
                {label}
              </span>
              <span className="block truncate text-[10.5px] text-muted-foreground">Workspace</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
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
