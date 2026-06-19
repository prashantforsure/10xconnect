import { Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BRAND_POINTS = [
  "A real safety engine keeps your accounts healthy",
  "AI-personalized messages & native voice notes",
  "Unified inbox that auto-stops on reply",
];

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen bg-background">
      {/* Brand panel */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-secondary p-12 lg:flex">
        <div className="pointer-events-none absolute inset-x-0 -top-32 h-96 bg-[radial-gradient(60%_60%_at_30%_0%,hsl(15_87%_59%/0.18),transparent)]" />
        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground shadow-soft">
            10x
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">Connect</span>
        </Link>
        <div className="relative">
          <span className="eyebrow">
            <ShieldCheck className="size-3.5 text-primary" /> Safety-first outreach
          </span>
          <h2 className="mt-5 font-display text-4xl font-bold leading-tight tracking-tight">
            Start more conversations on LinkedIn — without burning your accounts.
          </h2>
          <ul className="mt-8 space-y-3">
            {BRAND_POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-3" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">
          © {new Date().getFullYear()} 10xConnect
        </p>
      </aside>

      {/* Form */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
              10x
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Connect</span>
          </Link>
          <h1 className="mb-6 font-display text-2xl font-bold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Banner({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
        {message}
      </p>
    );
  }
  return null;
}

export function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
}) {
  return (
    <div className="mb-4 space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required autoComplete={autoComplete} />
    </div>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <Button type="submit" className="w-full">
      {children}
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      OR
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function GoogleButton() {
  return (
    <Button type="submit" variant="outline" className="w-full">
      <svg className="size-4" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
      Continue with Google
    </Button>
  );
}
