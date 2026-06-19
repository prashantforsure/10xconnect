import { env } from "@10xconnect/config";

const ACCOUNT_ID = "ThYaIYExS1a9XPy-AoSS3w";
const KEYWORDS = process.argv[2] ?? "founder";
const LIMIT = "5";

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}

async function main(): Promise<void> {
  const url = new URL(baseUrl() + "/api/v1/linkedin/search");
  url.searchParams.set("account_id", ACCOUNT_ID);
  url.searchParams.set("limit", LIMIT);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ api: "classic", category: "people", keywords: KEYWORDS }),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  console.log(`POST /linkedin/search keywords="${KEYWORDS}" → ${res.status}`);
  if (!res.ok) {
    console.log(JSON.stringify(data).slice(0, 600));
    return;
  }
  const items: any[] = data.items ?? [];
  console.log(`Returned ${items.length} people (total≈${data.paging?.total_count ?? data.paging?.total ?? "?"}):\n`);
  for (const it of items) {
    const name = it.name ?? `${it.first_name ?? ""} ${it.last_name ?? ""}`.trim();
    console.log(`• ${name || "(no name)"} — ${it.headline ?? it.occupation ?? ""}`);
    console.log(`    id=${it.provider_id ?? it.id ?? it.member_id ?? "?"} public=${it.public_identifier ?? "?"} dist=${it.network_distance ?? "?"}`);
  }
}

main().catch((e: unknown) => {
  console.error("search failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
