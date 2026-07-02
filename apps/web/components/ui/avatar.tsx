"use client";

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

/**
 * Deterministic dark tint per name so avatars are consistent across renders.
 * On Command Dark the tint.* values are dark warm fills, so the initials read
 * in the accent color over them for a calm, legible chip.
 */
const TINTS = [
  "bg-tint-coral text-primary",
  "bg-tint-blue text-chart-2",
  "bg-tint-green text-success",
  "bg-tint-violet text-chart-4",
  "bg-tint-amber text-warning",
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
  ({ className, name, src, size = "md", ...props }, ref) => {
    // Fall back to initials if the photo fails to load (broken/expired LinkedIn
    // CDN URL, offline, etc.). Reset the error when the src changes.
    const [errored, setErrored] = React.useState(false);
    React.useEffect(() => setErrored(false), [src]);
    const showImage = Boolean(src) && !errored;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ring-2 ring-card",
          SIZES[size],
          !showImage && tintFor(name),
          className,
        )}
        {...props}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src as string}
            alt={name ?? "avatar"}
            className="size-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        ) : (
          initials(name)
        )}
      </span>
    );
  },
);
Avatar.displayName = "Avatar";

export { Avatar };
