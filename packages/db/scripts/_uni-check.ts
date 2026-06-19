import { env } from "@10xconnect/config";

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}

async function main(): Promise<void> {
  console.log(`DSN base: ${baseUrl()}`);
  const res = await fetch(baseUrl() + "/api/v1/accounts", {
    method: "GET",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json" },
  });
  const data = (await res.json()) as { items?: any[] };
  console.log(`GET /api/v1/accounts → ${res.status}, ${data.items?.length ?? 0} account(s)\n`);
  for (const a of data.items ?? []) {
    const im = a.connection_params?.im ?? {};
    console.log(
      `account_id=${a.id}\n  name=${a.name}\n  type=${a.type}\n  publicIdentifier=${im.publicIdentifier}\n` +
        `  provider_member_id=${im.id}\n  sources=${JSON.stringify(a.sources ?? [])}\n  proxy=${JSON.stringify(im.proxy ?? {})}\n`,
    );
  }
}

main().catch((e: unknown) => {
  console.error("check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
