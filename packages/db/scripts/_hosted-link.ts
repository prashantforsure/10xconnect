import { randomUUID } from "node:crypto";

import { env } from "@10xconnect/config";

const EXISTING_ACCOUNT = "ThYaIYExS1a9XPy-AoSS3w"; // reconnect this account in place

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}

async function tryLink(body: Record<string, unknown>, label: string): Promise<string | null> {
  const res = await fetch(baseUrl() + "/api/v1/hosted/accounts/link", {
    method: "POST",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (res.ok && data?.url) {
    console.log(`\n✅ ${label} hosted link:\n${data.url}\n`);
    return data.url;
  }
  console.log(`✗ ${label} failed [${res.status}]: ${JSON.stringify(data).slice(0, 400)}`);
  return null;
}

async function main(): Promise<void> {
  const expiresOn = new Date(Date.now() + 30 * 60_000).toISOString();
  const common = {
    providers: ["LINKEDIN"],
    api_url: baseUrl(),
    expiresOn,
    success_redirect_url: `${env.APP_URL}/connect/callback?status=success`,
    failure_redirect_url: `${env.APP_URL}/connect/callback?status=failure`,
    notify_url: `${env.API_PUBLIC_URL}/api/v1/webhooks/hosted/unipile`,
    name: randomUUID(),
  };
  // Prefer reconnect-in-place (keeps the same account_id the DB points at).
  const reconnect = await tryLink(
    { ...common, type: "reconnect", reconnect_account: EXISTING_ACCOUNT },
    "RECONNECT",
  );
  if (reconnect) return;
  // Fallback: a fresh create link.
  await tryLink({ ...common, type: "create" }, "CREATE");
}

main().catch((e: unknown) => {
  console.error("hosted-link failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
