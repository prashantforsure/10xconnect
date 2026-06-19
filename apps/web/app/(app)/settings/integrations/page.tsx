import { IntegrationsClient } from "@/components/settings/integrations-client";

export default function IntegrationsSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect your CRM, calendar, Slack, and automation tools.
        </p>
      </header>
      <IntegrationsClient />
    </div>
  );
}
