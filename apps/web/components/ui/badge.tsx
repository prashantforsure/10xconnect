import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Status chips render as tint pills: low-alpha accent bg + solid accent text,
// no border, ~10.5px / 600, radius 5px. Use these variants (never bespoke
// one-offs). Default = info/AI (indigo tint + #9BA3EB text).
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[10.5px] font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/[0.14] text-indigo-text",
        secondary: "bg-white/[0.06] text-white/55",
        outline: "border border-white/10 text-white/70",
        muted: "bg-white/[0.06] text-white/55",
        success: "bg-success/[0.13] text-success",
        warning: "bg-warning/[0.13] text-warning",
        destructive: "bg-destructive/[0.12] text-destructive",
        info: "bg-linkedin/[0.14] text-linkedin",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a leading status dot (uses the badge's text color + a soft glow). */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current shadow-[0_0_6px_currentColor]"
        />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
