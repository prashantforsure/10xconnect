"use client";

import { LogOut } from "lucide-react";

import { logout } from "@/app/auth/actions";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email, collapsed = false }: { email: string; collapsed?: boolean }) {
  const monogram = (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-avatar text-[10.5px] font-semibold text-white/75">
      {email.charAt(0).toUpperCase()}
    </span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <button
            type="button"
            title={email}
            className="mx-auto flex items-center justify-center rounded-md p-1 transition-colors hover:bg-white/[0.05]"
          >
            {monogram}
          </button>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
          >
            {monogram}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-white/85">
                {email.split("@")[0]}
              </span>
              <span className="block truncate text-[11px] font-normal text-white/40">{email}</span>
            </span>
          </button>
        )}
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
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-white/70 outline-none transition-colors hover:bg-white/[0.06] hover:text-foreground [&_svg]:size-4"
          >
            <LogOut />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
