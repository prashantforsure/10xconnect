import { WebhooksClient } from "@/components/settings/webhooks-client";

export default function WebhooksSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Get notified at your endpoint on replies, accepted invites, and account status changes.
        </p>
      </header>
      <WebhooksClient />
    </div>
  );
}
