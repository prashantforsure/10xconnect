import { BillingClient } from "@/components/settings/billing-client";

export default function BillingSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Pay per sending-account slot. Campaigns, contacts, and team members are unlimited.
        </p>
      </header>
      <BillingClient />
    </div>
  );
}
