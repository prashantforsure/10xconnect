export function PagePlaceholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex h-full flex-col p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {description ?? "This page is a placeholder — functionality arrives in a later step."}
      </p>
    </div>
  );
}
