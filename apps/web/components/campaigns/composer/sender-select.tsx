"use client";

import { Check, ChevronDown, Info } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

export interface SenderAccount {
  id: string;
  name: string | null;
  status: string;
}

/**
 * Per-node sender selector. Multi-select supports account rotation, but a
 * workspace has at most one LinkedIn account today (CLAUDE.md §6) — rotation is a
 * forward-compatible no-op until multiple accounts can be connected.
 */
export function SenderSelect({
  accounts,
  value,
  onChange,
  disabled,
}: {
  accounts: SenderAccount[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const selected = accounts.filter((a) => value.includes(a.id));
  const toggle = (id: string): void => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const label =
    selected.length === 0
      ? "Use campaign account"
      : selected.length === 1
        ? (selected[0].name ?? "LinkedIn account")
        : `${selected.length} accounts`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Sender account</label>
        {accounts.length <= 1 ? (
          <Tooltip content="Rotation across multiple accounts unlocks when you connect more accounts.">
            <Info className="size-3.5 text-muted-foreground" />
          </Tooltip>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal" disabled={disabled}>
            <span className="flex items-center gap-2 truncate">
              {selected.length === 1 ? <Avatar name={label} size="sm" /> : null}
              <span className="truncate">{label}</span>
            </span>
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {accounts.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-muted-foreground">No connected accounts</div>
          ) : (
            accounts.map((a) => {
              const checked = value.includes(a.id);
              return (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    toggle(a.id);
                  }}
                >
                  <Avatar name={a.name ?? "LinkedIn account"} size="sm" />
                  <span className="flex-1 truncate">{a.name ?? "LinkedIn account"}</span>
                  <span className="text-xs text-muted-foreground">{a.status}</span>
                  {checked ? <Check className="size-4 text-primary" /> : null}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
