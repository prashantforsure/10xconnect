import { AgencyClient } from "@/components/agency/agency-client";

export default function AgencyPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Agency</h1>
        <p className="text-sm text-muted-foreground">
          Every client workspace you manage, in one place — performance and account health at a glance.
        </p>
      </header>
      <AgencyClient />
    </div>
  );
}
