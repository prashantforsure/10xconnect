import * as React from "react";

import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name?: string;
  src?: string | null;
  size?: keyof typeof SIZES;
}

/** Deterministic warm tint per name so avatars are consistent across renders. */
const TINTS = [
  "bg-tint-coral text-primary",
  "bg-tint-blue text-[hsl(205_70%_38%)]",
  "bg-tint-green text-[hsl(150_50%_30%)]",
  "bg-tint-violet text-[hsl(265_45%_45%)]",
  "bg-tint-amber text-[hsl(35_80%_35%)]",
];

function initials(name?: string): string {
  if (!name) {
    return "?";
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function tintFor(name?: string): string {
  const key = name ?? "";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, name, src, size = "md", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ring-2 ring-card",
        SIZES[size],
        !src && tintFor(name),
        className,
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ?? "avatar"} className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  ),
);
Avatar.displayName = "Avatar";

export { Avatar };
