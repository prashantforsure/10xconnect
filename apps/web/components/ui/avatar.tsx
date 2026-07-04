"use client";

import * as React from "react";

import { cn, proxiedAvatarSrc } from "@/lib/utils";

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
 * Neutral monogram fill per the design — a calm avatar circle (#2A2C33) with
 * white/75 initials, consistent across the app regardless of name.
 */
const MONOGRAM = "bg-avatar text-white/75";

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

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, name, src, size = "md", ...props }, ref) => {
    // Fall back to initials if the photo fails to load (broken/expired LinkedIn
    // CDN URL, offline, etc.). Reset the error when the src changes.
    const [errored, setErrored] = React.useState(false);
    React.useEffect(() => setErrored(false), [src]);
    // Route the (external) photo through our proxy so LinkedIn CDN images load.
    const proxied = proxiedAvatarSrc(src);
    const showImage = Boolean(proxied) && !errored;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
          SIZES[size],
          !showImage && MONOGRAM,
          className,
        )}
        {...props}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxied as string}
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
