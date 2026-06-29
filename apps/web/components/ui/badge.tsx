import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Command Dark badges render as wash pills: bg-<sem>/15 + text-<sem>, no border,
// ~11.5px / 700. Status/safety pills should use these variants (never bespoke
// rose/amber/violet one-offs).
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-foreground",
        muted: "bg-muted-foreground/15 text-muted-foreground",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        destructive: "bg-destructive/15 text-destructive",
        info: "bg-chart-2/15 text-chart-2",
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
