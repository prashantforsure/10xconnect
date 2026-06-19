import { AccountsClient } from "@/components/settings/accounts-client";

export default function AccountsSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">LinkedIn accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect the LinkedIn accounts you send from. New accounts warm up automatically and run
          inside safe daily limits.
        </p>
      </header>
      <AccountsClient />
    </div>
  );
}
