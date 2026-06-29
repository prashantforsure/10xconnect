import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary coral with a soft coral glow.
        default:
          "bg-primary text-white shadow-[0_0_18px_-5px_rgba(242,104,60,.6)] hover:bg-primary/90 active:scale-[0.98]",
        // Destructive renders as a wash, not a solid fill, on the dark surface.
        destructive:
          "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
        outline:
          "border border-input bg-secondary text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-foreground border border-input hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-[10px] px-6 text-base",
        // Square 38px icon button — geometry only; the variant supplies the surface
        // (ghost stays transparent; secondary/outline give the raised #1A1811 chip look).
        icon: "size-[38px] rounded-[10px]",
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
