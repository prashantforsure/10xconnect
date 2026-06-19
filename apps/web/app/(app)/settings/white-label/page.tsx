import { WhiteLabelClient } from "@/components/settings/white-label-client";

export default function WhiteLabelSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">White label</h1>
        <p className="text-sm text-muted-foreground">
          Brand the client-facing surfaces (reports, custom domain) for your agency.
        </p>
      </header>
      <WhiteLabelClient />
    </div>
  );
}
