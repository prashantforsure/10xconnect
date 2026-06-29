// TEMP read-only: inspect what Unipile actually returns for our account's chats +
// messages, so we can see whether the recipient's reply has synced and how the
// thread is keyed (attendee id vs our resolved providerId).
import { env } from "@10xconnect/config";

const ACCOUNT_ID = "uxaTCR-DQkaaXW_Ypxne-A"; // xyz LinkedIn provider account
const PROVIDER_ID = "ACoAAEVgyB0B2ObGlxh9XQzz_O6j9AHpk7dLryQ"; // recipient

function baseUrl(): string {
  const dsn = (env.UNIPILE_DSN ?? "").trim();
  return /^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`;
}
function headers(): Record<string, string> {
  return { "X-API-KEY": env.UNIPILE_API_KEY ?? "", accept: "application/json" };
}
async function get<T = any>(path: string, q: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const url = new URL(baseUrl() + path);
  for (const [k, v] of Object.entries(q)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: headers() });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function main(): Promise<void> {
  console.log("1) chats filtered by attendee_id (what fetchConversation uses):");
  const byAtt = await get<any>("/api/v1/chats", { account_id: ACCOUNT_ID, attendee_id: PROVIDER_ID });
  console.log(`   status=${byAtt.status} items=${byAtt.data.items?.length ?? 0}`);
  console.log(`   raw=${JSON.stringify(byAtt.data).slice(0, 300)}`);

  console.log("\n2) ALL recent chats for the account:");
  const all = await get<any>("/api/v1/chats", { account_id: ACCOUNT_ID, limit: "10" });
  console.log(`   status=${all.status} items=${all.data.items?.length ?? 0}`);
  for (const c of all.data.items ?? []) {
    console.log(`   chat id=${c.id} attendee_provider_id=${c.attendee_provider_id} name=${c.name ?? "?"} content_type=${c.content_type ?? "-"} ts=${c.timestamp ?? "?"}`);
  }

  // Pick the chat whose attendee matches, else the most recent, and show messages.
  const chat = (all.data.items ?? []).find((c: any) => c.attendee_provider_id === PROVIDER_ID) ?? (byAtt.data.items ?? [])[0] ?? (all.data.items ?? [])[0];
  if (chat?.id) {
    console.log(`\n3) messages for chat ${chat.id} (attendee=${chat.attendee_provider_id}):`);
    const msgs = await get<any>(`/api/v1/chats/${encodeURIComponent(chat.id)}/messages`, { limit: "20" });
    console.log(`   status=${msgs.status} items=${msgs.data.items?.length ?? 0}`);
    for (const m of msgs.data.items ?? []) {
      console.log(`   [${m.is_sender ? "us " : "them"}] ${JSON.stringify(m.text)?.slice(0, 90)} id=${m.id} ts=${m.timestamp}`);
    }
  } else {
    console.log("\n3) no chat found to inspect.");
  }
}

main().catch((e: unknown) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
