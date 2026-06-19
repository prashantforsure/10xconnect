import { ApiKeysClient } from "@/components/settings/api-keys-client";

export default function ApiSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">API</h1>
        <p className="text-sm text-muted-foreground">
          Generate workspace API keys for the public API. Treat keys like passwords.
        </p>
      </header>
      <ApiKeysClient />
    </div>
  );
}
