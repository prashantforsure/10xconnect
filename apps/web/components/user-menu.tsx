"use client";

import { LogOut } from "lucide-react";

import { logout } from "@/app/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left"
        >
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-input bg-muted font-display text-[11px] font-bold text-primary">
            {email.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-foreground">
              {email.split("@")[0]}
            </span>
            <span className="block truncate text-[10.5px] font-normal text-muted-foreground">
              {email}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
          <Avatar name={email} size="sm" />
          <span className="truncate text-sm text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
          >
            <LogOut />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
