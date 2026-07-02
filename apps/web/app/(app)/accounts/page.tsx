import { AccountsClient } from "@/components/settings/accounts-client";

export default function AccountsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          The LinkedIn accounts you send from. Connect as many as your plan allows — each warms up
          automatically, runs on its own region-matched proxy, and stays inside safe daily limits.
        </p>
      </header>
      <AccountsClient />
    </div>
  );
}
