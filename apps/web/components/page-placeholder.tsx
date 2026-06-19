import { Sparkles } from "lucide-react";

export function PagePlaceholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-7" />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {description ?? "This page is a placeholder — functionality arrives in a later step."}
      </p>
    </div>
  );
}
