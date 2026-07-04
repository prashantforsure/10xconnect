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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            10x
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">Connect</span>
        </Link>

        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mb-6 mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Safety-first LinkedIn + email outreach
          </p>
          {children}
        </div>

        <ul className="mt-6 space-y-2 px-1">
          {BRAND_POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/[0.14] text-primary">
                <Check className="size-2.5" />
              </span>
              {p}
            </li>
          ))}
        </ul>

        <p className="mt-6 text-center text-[11px] text-white/35">
          © {new Date().getFullYear()} 10xConnect
        </p>
      </div>
    </main>
  );
}

export function Banner({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/[0.12] px-3 py-2 text-[13px] text-destructive">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p className="mb-4 rounded-md border border-success/30 bg-success/[0.13] px-3 py-2 text-[13px] text-success">
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
