import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[14px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary indigo, weight 600, flat (no glow).
        default: "bg-primary font-semibold text-white hover:bg-primary/90 active:scale-[0.98]",
        // Destructive renders as a wash on the dark surface.
        destructive:
          "border border-destructive/40 bg-destructive/[0.12] text-destructive hover:bg-destructive/[0.18]",
        // Secondary / outline: transparent + hairline border.
        outline: "border border-white/[0.12] bg-transparent text-white/85 hover:bg-white/[0.05]",
        secondary: "border border-white/[0.12] bg-transparent text-white/85 hover:bg-white/[0.05]",
        ghost: "bg-transparent text-white/45 hover:bg-white/[0.05] hover:text-white/75",
        link: "text-indigo-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-4 py-1.5",
        sm: "h-7 rounded-sm px-3 text-[12px]",
        lg: "h-9 px-5 text-[13px]",
        // Square icon button — geometry only; the variant supplies the surface.
        icon: "size-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
