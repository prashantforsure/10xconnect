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

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  const label =
    activeWorkspace?.name ?? (workspaces.length === 0 ? "Create a workspace" : "Select workspace");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <button
              type="button"
              title={label}
              className="mx-auto flex size-8 items-center justify-center rounded-md border border-border bg-surface transition-colors hover:bg-accent"
            >
              <span className="size-4 shrink-0 rounded bg-gradient-to-br from-primary to-branch" />
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-[7px] text-left text-[12.5px] font-medium text-white/75 transition-colors hover:bg-accent"
            >
              <span className="size-4 shrink-0 rounded bg-gradient-to-br from-primary to-branch" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-white/40" />
            </button>
          )}
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
