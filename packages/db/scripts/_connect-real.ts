import { env } from "@10xconnect/config";

import { createPgClient } from "./db-utils";

// --- inputs (from the environment, never committed) -------------------------
// Pass these at run time so the li_at (a secret) is never written into a
// git-tracked file, and so we send the operator's REAL user-agent — a UA that
// doesn't match the browser the li_at came from is the #1 cause of LinkedIn
// logging the account out (apps/extension/STAYING-CONNECTED.md).
//
//   $env:LI_AT="<fresh li_at>"
//   $env:LI_USER_AGENT="<exact navigator.userAgent of that browser>"
//   pnpm --filter @10xconnect/db exec tsx scripts/_connect-real.ts
const LI_AT = (process.env.LI_AT ?? "").trim();
const COUNTRY = (process.env.LI_COUNTRY ?? "IN").trim(); // region-matched residential IP (anti "impossible travel" logout)
const USER_EMAIL = (process.env.LI_USER_EMAIL ?? "pp9926521681@gmail.com").trim();
// The operator's real browser user-agent. The hardcoded value here is ONLY a
// last-resort fallback — it almost certainly will NOT match your browser, so
// always pass LI_USER_AGENT. We warn below when the fallback is used.
const UA_FALLBACK =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA = (process.env.LI_USER_AGENT ?? "").trim() || UA_FALLBACK;

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}
function headers(extra?: Record<string, string>): Record<string, string> {
  return { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json", ...extra };
}
async function uni<T = any>(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(baseUrl() + path, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

async function connect(): Promise<{ accountId: string } | null> {
  const base = { provider: "LINKEDIN", access_token: LI_AT, user_agent: UA };
  // Try region-matched proxy first, then fall back to Unipile default.
  for (const body of [{ ...base, country: COUNTRY }, base]) {
    const tag = "country" in body ? `country=${COUNTRY}` : "no-proxy";
    const r = await uni<{ account_id?: string; object?: string }>("/api/v1/accounts", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (r.ok && r.data?.account_id) {
      console.log(`✅ connect (${tag}) → account_id=${r.data.account_id}`);
      return { accountId: r.data.account_id };
    }
    console.log(`✗ connect (${tag}) failed [${r.status}]:`, JSON.stringify(r.data));
  }
  return null;
}

async function main(): Promise<void> {
  if (!LI_AT) {
    console.log(
      "❌ LI_AT is not set. Pass a fresh li_at via the environment, e.g.:\n" +
        '   $env:LI_AT="<fresh li_at>"; $env:LI_USER_AGENT="<navigator.userAgent>"; ' +
        "pnpm --filter @10xconnect/db exec tsx scripts/_connect-real.ts",
    );
    process.exit(2);
  }
  if (!process.env.LI_USER_AGENT) {
    console.log(
      "⚠ LI_USER_AGENT not set — falling back to a generic Chrome UA. This likely does NOT " +
        "match the browser your li_at came from, which is the #1 cause of repeated logouts. " +
        "Set LI_USER_AGENT to that browser's navigator.userAgent for a stable session.",
    );
  }
  console.log(`Unipile DSN: ${baseUrl()}`);
  console.log(`country=${COUNTRY}  user-agent=${UA.slice(0, 48)}…  target=${USER_EMAIL}`);
  const conn = await connect();
  if (!conn) {
    console.log("\n❌ Unipile rejected this li_at — it is invalid/expired or the account is checkpointed.");
    process.exit(2);
  }

  // Poll the account a few times (it may report CONNECTING right after creation).
  let acct: any = null;
  for (let i = 0; i < 6; i += 1) {
    const r = await uni<any>(`/api/v1/accounts/${conn.accountId}`, { method: "GET", headers: headers() });
    acct = r.data;
    const status = acct?.sources?.[0]?.status;
    console.log(`account poll ${i + 1}: status=${status ?? "?"} name=${acct?.name ?? "?"}`);
    if (status && status !== "CONNECTING") break;
    await new Promise((res) => setTimeout(res, 3000));
  }

  const publicId =
    acct?.connection_params?.im?.publicIdentifier ?? acct?.connection_params?.im?.username;
  console.log(`\n=== ACCOUNT OWNER (from the live LinkedIn session) ===`);
  console.log(`name (account):     ${acct?.name ?? "?"}`);
  console.log(`public identifier:  ${publicId ?? "?"}`);
  console.log(`source status:      ${acct?.sources?.[0]?.status ?? "?"}`);

  // Fetch the owner's own profile for a fuller verification (real name + headline).
  if (publicId) {
    const p = await uni<any>(
      `/api/v1/users/${encodeURIComponent(String(publicId))}?account_id=${conn.accountId}`,
      { method: "GET", headers: headers() },
    );
    if (p.ok) {
      console.log(`\n=== PROFILE (GET /users/${publicId}) ===`);
      console.log(`first/last:  ${p.data?.first_name ?? "?"} ${p.data?.last_name ?? "?"}`);
      console.log(`headline:    ${p.data?.headline ?? "?"}`);
      console.log(`provider_id: ${p.data?.provider_id ?? "?"}`);
      console.log(`location:    ${p.data?.location ?? "?"}`);
    } else {
      console.log(`profile fetch [${p.status}]:`, JSON.stringify(p.data));
    }
  }

  // --- swap the mock account in the user's workspace for this real one -------
  const client = createPgClient();
  await client.connect();
  try {
    const { rows: targets } = await client.query(
      `select sa.id, sa.workspace_id, w.name as ws_name, sa.provider_account_id, sa.status
         from public.sending_accounts sa
         join public.memberships m on m.workspace_id = sa.workspace_id
         join public.profiles p on p.id = m.user_id
         join public.workspaces w on w.id = sa.workspace_id
        where sa.type = 'linkedin' and lower(p.email) = lower($1)`,
      [USER_EMAIL],
    );
    console.log(`\n=== your LinkedIn accounts (${targets.length}) ===`);
    for (const t of targets) {
      console.log(
        `- account=${String(t.id).slice(0, 8)} ws=${t.ws_name} provider=${t.provider_account_id} status=${t.status}`,
      );
    }
    if (targets.length === 0) {
      console.log("No LinkedIn account found in your workspaces — connect once via the UI first.");
      return;
    }
    if (targets.length > 1) {
      console.log("⚠ Multiple workspaces have a LinkedIn account — not auto-updating. Tell me which workspace.");
      return;
    }
    const target = targets[0];
    const ownerName: string = acct?.name ?? "LinkedIn account";
    await client.query(
      `update public.sending_accounts
          set provider_account_id = $1,
              connection_method = 'cookie',
              status = 'warming',
              name = $2,
              country = $3,
              updated_at = now()
        where id = $4`,
      [conn.accountId, ownerName, COUNTRY, target.id],
    );
    console.log(
      `\n✅ Updated account ${String(target.id).slice(0, 8)} in "${target.ws_name}": ` +
        `provider_account_id ${target.provider_account_id} → ${conn.accountId} (real Unipile account).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error("connect-real failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
