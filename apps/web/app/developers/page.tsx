// PUBLIC developer docs (outside the (app) group — no auth, no shell): the
// curated reference for the public API, webhooks (events, payloads, signature
// verification), Slack, Zapier/n8n/Make/Clay recipes, and the MCP server.
// Hand-written on purpose (no Swagger): this is the STABLE subset we commit to;
// undocumented routes may change without notice.
//
// Every integration section is written as a numbered, do-this-then-that guide so
// a first-time user can connect WITHOUT guessing, and each carries an honest
// status badge (Live / Beta / Coming soon) — the catalog on
// /settings/integrations is the source of truth for what is connectable today.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "10xConnect — Developers",
  description:
    "Step-by-step guides for the 10xConnect public API, signed webhooks, Slack, Zapier/n8n/Make/Clay, and the MCP server.",
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

type Status = "live" | "beta" | "soon";

const ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: "GET", path: "/campaigns", note: "List campaigns with status + lead counts" },
  { method: "GET", path: "/campaigns/:id", note: "Campaign detail" },
  { method: "POST", path: "/campaigns/:id/start", note: "Run a campaign" },
  { method: "POST", path: "/campaigns/:id/pause", note: "Pause (freeze in place)" },
  { method: "POST", path: "/campaigns/:id/resume", note: "Resume a paused campaign" },
  { method: "POST", path: "/campaigns/:id/leads", note: "Enroll leads into a campaign" },
  { method: "GET", path: "/analytics/campaign/:id", note: "Campaign metrics: requests, accepts (+%), replies (+%)" },
  { method: "GET", path: "/leads", note: "List/search contacts" },
  { method: "POST", path: "/leads/import", note: "Import leads (csv | profile_urls | …)" },
  { method: "GET", path: "/conversations", note: "Unified inbox (filter, accountId)" },
  { method: "GET", path: "/conversations/:id", note: "Full thread + lead panel" },
  { method: "POST", path: "/conversations/:id/reply", note: "Queue a reply (idempotent dispatch)" },
  { method: "GET", path: "/accounts", note: "Sending accounts + status + health" },
  { method: "GET", path: "/accounts/:id/health", note: "Acceptance rate, volume vs caps" },
  { method: "GET", path: "/analytics/workspace", note: "Workspace analytics" },
  { method: "GET", path: "/suppression", note: "Do-not-contact list" },
  { method: "POST", path: "/suppression", note: "Add to do-not-contact" },
  { method: "GET", path: "/webhooks", note: "List outbound webhooks" },
  { method: "POST", path: "/webhooks", note: "Create webhook (returns signing secret ONCE)" },
  { method: "DELETE", path: "/webhooks/:id", note: "Delete webhook" },
];

const EVENTS: Array<{ type: string; when: string }> = [
  { type: "reply", when: "A lead replies (sequence auto-stops, thread lands in the inbox)" },
  { type: "accepted_invite", when: "A connection request is accepted" },
  { type: "message_sent", when: "A message-bearing action is sent (DM, connection request, InMail, voice note)" },
  { type: "hot_lead", when: "The AI SDR detects buying intent and escalates to a human" },
  { type: "campaign_completed", when: "Every enrolled lead reached a terminal state" },
  { type: "status_change", when: "A sending account is restricted or hits a checkpoint (auto-paused)" },
];

const SAMPLE_PAYLOAD = `{
  "id": "5f3c…-event-uuid",            // unique per event — use as idempotency key
  "type": "reply",
  "created_at": "2026-07-04T10:15:00Z",
  "workspace_id": "…",
  "data": {
    "lead": { "id": "…", "name": "Jordan Reyes", "linkedin_url": "https://linkedin.com/in/…" },
    "conversation_id": "…",
    "campaign_id": "…",
    "account_id": "…",
    "channel": "linkedin",
    "message": { "body": "Interesting — tell me more?" }
  }
}`;

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, signatureHeader, rawBody) {
  // X-10xC-Signature: t=<unix-seconds>,v1=<hex>
  const [tPart, vPart] = signatureHeader.split(",");
  const t = tPart.slice(2), v1 = vPart.slice(3);
  const expected = createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300; // 5 min replay window
  return fresh && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}`;

const MCP_JSON = `{
  "mcpServers": {
    "10xconnect": {
      "url": "${API_BASE}/mcp",
      "headers": { "Authorization": "Bearer 10xc_YOUR_API_KEY" }
    }
  }
}`;

// The full MCP tool surface (source of truth: apps/api/.../mcp-tools.service.ts).
// Read tools are available to every key; write tools only to "All" keys — a
// Read-only key never even sees them in tools/list.
const MCP_TOOLS: Array<{ tool: string; access: "read" | "write"; params: string; returns: string }> = [
  { tool: "list_accounts", access: "read", params: "—", returns: "Connected LinkedIn accounts + status + health" },
  { tool: "get_account_health", access: "read", params: "accountId", returns: "Acceptance rate, volume vs caps, restrictions, score" },
  { tool: "list_campaigns", access: "read", params: "—", returns: "Campaigns with status + lead counts" },
  { tool: "get_campaign", access: "read", params: "campaignId", returns: "One campaign's detail" },
  { tool: "get_campaign_analytics", access: "read", params: "campaignId", returns: "Requests, accepts (+%), replies (+%), likes/comments" },
  { tool: "get_workspace_analytics", access: "read", params: "range? (7d | 30d | all)", returns: "Workspace-level outreach analytics" },
  { tool: "search_leads", access: "read", params: "query?, limit? (1–100)", returns: "Leads by name, company, headline, email, URL" },
  { tool: "get_lead", access: "read", params: "leadId", returns: "One lead's full profile + enrichment" },
  { tool: "list_conversations", access: "read", params: "filter? (all | reply_required | important), accountId?", returns: "Inbox threads across accounts" },
  { tool: "get_conversation", access: "read", params: "conversationId", returns: "Full message thread + lead panel" },
  { tool: "list_webhooks", access: "read", params: "—", returns: "Outbound webhooks (URL, events, status)" },
  { tool: "pause_campaign", access: "write", params: "campaignId", returns: "Freezes dispatch in place (resumable)" },
  { tool: "resume_campaign", access: "write", params: "campaignId", returns: "Resumes each lead where it stopped" },
  { tool: "send_reply", access: "write", params: "conversationId, body (1–8000)", returns: "Queues a reply through the dispatch engine" },
  { tool: "create_webhook", access: "write", params: "url, events[], name?", returns: "Creates a webhook; returns the signing secret once" },
];

const ERRORS: Array<{ status: string; when: string }> = [
  { status: "401", when: "Missing or invalid API key" },
  { status: "403", when: "Read-only key on a write, or a route API keys can't reach (billing, workspace/member, key management)" },
  { status: "404", when: "Resource missing or not in your workspace" },
  { status: "422 / 400", when: "Request body or query failed validation — the message names the field" },
  { status: "429", when: "Over 60 requests/minute for this key — back off and retry" },
];

const ERROR_BODY = `// Errors are JSON with a numeric statusCode + human message:
{ "statusCode": 403, "message": "This API key is read-only", "error": "Forbidden" }
{ "statusCode": 401, "message": "Invalid API key" }
{ "statusCode": 429, "message": "API key rate limit exceeded (60 requests/minute). Retry in 42s." }`;

const PAGINATION = `# List endpoints page with limit + offset (limit max 200, default 50).
curl "${API_BASE}/leads?limit=50&offset=0&search=acme" \\
  -H "Authorization: Bearer 10xc_YOUR_API_KEY"

# → { "leads": [ … ], "total": 128, "limit": 50, "offset": 0 }
# Fetch the next page with offset=50, then offset=100, until offset ≥ total.`;

// The integration catalog, mirrored from /settings/integrations, with the ONE
// place a user actually connects each and what state it is in.
const CATALOG: Array<{ name: string; status: Status; where: string; how: string }> = [
  { name: "REST API (keys)", status: "live", where: "Settings → API", how: "Bearer 10xc_ key" },
  { name: "Webhooks", status: "live", where: "Settings → Webhooks", how: "Signed outbound POST" },
  { name: "Slack", status: "live", where: "Settings → Integrations", how: "Incoming-webhook URL" },
  { name: "MCP server", status: "live", where: "Settings → Integrations", how: "API key + MCP client" },
  { name: "Zapier", status: "live", where: "Zapier.com", how: "API key + Webhooks by Zapier" },
  { name: "Make", status: "live", where: "Make.com", how: "API key + custom webhook" },
  { name: "Clay", status: "live", where: "Clay.com", how: "API key (HTTP) + webhooks" },
  { name: "n8n (branded node)", status: "beta", where: "n8n custom nodes", how: "Local install (npm publish pending)" },
  { name: "HubSpot / Salesforce / Pipedrive", status: "soon", where: "—", how: "Roadmap — use webhooks meanwhile" },
  { name: "Calendly / Cal.com", status: "soon", where: "—", how: "Roadmap — use webhooks meanwhile" },
];

const STATUS_LABEL: Record<Status, string> = {
  live: "Live",
  beta: "Beta",
  soon: "Coming soon",
};

function StatusBadge({ status }: { status: Status }) {
  const cls =
    status === "live"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "beta"
        ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-inset p-4 text-xs leading-relaxed text-muted-foreground">
      {children}
    </pre>
  );
}

function Section({
  id,
  title,
  status,
  children,
}: {
  id: string;
  title: string;
  status?: Status;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {status ? <StatusBadge status={status} /> : null}
      </div>
      {children}
    </section>
  );
}

// A reusable numbered "how to connect" list — the spine of every guide below.
function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{children}</ol>;
}

export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-primary">10xConnect</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Developers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Plug 10xConnect into your stack: a workspace-scoped REST API, signed webhooks, a Slack
          connector, Zapier / n8n / Make / Clay recipes, and a remote MCP server for AI agents.
          Every section below is a step-by-step guide — start with the{" "}
          <a href="#quickstart" className="text-primary underline">
            Quickstart
          </a>
          .
        </p>
        <nav className="mt-4 flex flex-wrap gap-2 text-xs">
          {[
            ["#quickstart", "Quickstart"],
            ["#status", "What's live"],
            ["#auth", "API keys"],
            ["#api", "REST API"],
            ["#errors", "Errors"],
            ["#webhooks", "Webhooks"],
            ["#slack", "Slack"],
            ["#zapier", "Zapier"],
            ["#n8n", "n8n"],
            ["#make", "Make"],
            ["#clay", "Clay"],
            ["#mcp", "MCP server"],
            ["#roadmap", "CRM & Calendar"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-12">
        {/* ---------------------------------------------------------------- */}
        <Section id="quickstart" title="Quickstart">
          <p className="text-sm text-muted-foreground">
            Three steps take you from zero to a working two-way integration. Everything else on this
            page is a deeper version of one of these.
          </p>
          <Steps>
            <li>
              <span className="font-medium text-foreground">Create an API key.</span> Open{" "}
              <Link href="/settings/api" className="text-primary underline">
                Settings → API
              </Link>
              , click <em>Generate key</em>, and copy it (shown once). See{" "}
              <a href="#auth" className="text-primary underline">
                API keys
              </a>
              .
            </li>
            <li>
              <span className="font-medium text-foreground">Call the API.</span> Send the key as a
              bearer token — this returns your campaigns:
              <Code>{`curl ${API_BASE}/campaigns \\
  -H "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
            </li>
            <li>
              <span className="font-medium text-foreground">Subscribe to events.</span> To be
              notified when a lead replies, add a receiver in{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>{" "}
              (or connect <a href="#slack" className="text-primary underline">Slack</a> for instant
              channel alerts). See <a href="#webhooks" className="text-primary underline">Webhooks</a>.
            </li>
          </Steps>
          <p className="text-xs text-muted-foreground">
            No-code tool instead of curl? Jump to{" "}
            <a href="#zapier" className="text-primary underline">Zapier</a>,{" "}
            <a href="#make" className="text-primary underline">Make</a>,{" "}
            <a href="#n8n" className="text-primary underline">n8n</a>, or{" "}
            <a href="#clay" className="text-primary underline">Clay</a>.
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="status" title="What's live today">
          <p className="text-sm text-muted-foreground">
            An honest map of every integration and where you connect it. <em>Live</em> = fully
            supported. <em>Beta</em> = works, still hardening. <em>Coming soon</em> = on the roadmap,
            not connectable yet (use webhooks in the meantime — see{" "}
            <a href="#roadmap" className="text-primary underline">CRM &amp; Calendar</a>).
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-inset text-left">
                  <th className="px-3 py-2 font-medium">Integration</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Connect in</th>
                  <th className="px-3 py-2 font-medium">Mechanism</th>
                </tr>
              </thead>
              <tbody>
                {CATALOG.map((c) => (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{c.name}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{c.where}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{c.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="auth" title="API keys" status="live">
          <p className="text-sm text-muted-foreground">
            Every request authenticates with a workspace API key sent as a bearer token. A key is
            scoped to ONE workspace, so you never send an <code>X-Workspace-Id</code> header.
          </p>
          <h3 className="text-sm font-semibold">Create a key</h3>
          <Steps>
            <li>
              Open{" "}
              <Link href="/settings/api" className="text-primary underline">
                Settings → API
              </Link>
              .
            </li>
            <li>
              Type a <span className="font-medium text-foreground">Name</span> (e.g. “Zapier”, “n8n”,
              “MCP”) so you can tell keys apart later.
            </li>
            <li>
              Pick a <span className="font-medium text-foreground">Permission</span>:{" "}
              <code>All</code> (read + write) or <code>Read-only</code> (safe for dashboards and AI
              agents that should never send).
            </li>
            <li>
              Click <span className="font-medium text-foreground">Generate key</span> and{" "}
              <span className="font-medium text-foreground">copy it immediately</span> — the full{" "}
              <code>10xc_…</code> value is shown only once. Store it in a secret manager.
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">Use it</h3>
          <Code>{`curl ${API_BASE}/campaigns \\
  -H "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Rate limit:</span> 60 requests/minute per
              key — a <code>429</code> whose message includes the retry delay in seconds.
            </li>
            <li>
              <span className="font-medium text-foreground">Read-only keys</span> are rejected on any
              write (any method other than GET/HEAD/OPTIONS).
            </li>
            <li>
              Billing, workspace/member management, and key management are never reachable with an API
              key — use the app for those.
            </li>
            <li>
              <span className="font-medium text-foreground">Rotate</span> by generating a new key and
              revoking the old one in the same screen (revocation is immediate).
            </li>
          </ul>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="api" title="REST API" status="live">
          <p className="text-sm text-muted-foreground">
            Base URL: <code>{API_BASE}</code>. JSON in, JSON out. The routes below are the stable,
            documented subset (other routes exist but may change without notice). Every write is
            idempotent at the dispatch layer — a retried send never double-messages a lead, and all
            sends respect the account&apos;s rate caps and working-hours schedule.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-inset text-left">
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">What it does</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={`${e.method} ${e.path}`} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono font-semibold">{e.method}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{e.path}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold">Pagination</h3>
          <p className="text-sm text-muted-foreground">
            List endpoints take <code>limit</code> + <code>offset</code> query params and return the
            page alongside a <code>total</code> so you can walk every result:
          </p>
          <Code>{PAGINATION}</Code>
          <h3 className="text-sm font-semibold">Idempotency</h3>
          <p className="text-sm text-muted-foreground">
            Sends are idempotent at the dispatch layer — enrolling the same lead or replying twice
            never double-messages them. On the receiving side, every webhook envelope carries a
            unique <code>id</code>; use it to de-duplicate deliveries (we may retry).
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="errors" title="Errors" status="live">
          <p className="text-sm text-muted-foreground">
            Every error is JSON with the HTTP status echoed in <code>statusCode</code> and a
            human-readable <code>message</code>. The common cases:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-inset text-left">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.status} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold">
                      {e.status}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code>{ERROR_BODY}</Code>
          <p className="text-xs text-muted-foreground">
            The <code>429</code> response means you crossed 60 requests/minute for that key — space
            out calls and retry. Billing, workspace/member, and key-management routes always return{" "}
            <code>403</code> to an API key; use the app for those.
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="webhooks" title="Webhooks" status="live">
          <p className="text-sm text-muted-foreground">
            Webhooks push an event to your endpoint the moment it happens — the fastest way to react
            to a <code>reply</code> or an <code>accepted_invite</code>. We POST a signed JSON envelope
            and retry with backoff for ~24 hours (6 retries). After 20 consecutive failures the
            webhook is auto-disabled and you&apos;re notified in-app.
          </p>
          <h3 className="text-sm font-semibold">Set one up</h3>
          <Steps>
            <li>
              Stand up an HTTPS endpoint that accepts <code>POST</code> and returns <code>2xx</code>{" "}
              quickly (do heavy work async). No public server yet? Point it at a Zapier/Make/n8n hook
              (below) or a{" "}
              <a href="https://webhook.site" target="_blank" rel="noreferrer" className="text-primary underline">
                webhook.site
              </a>{" "}
              URL to watch deliveries.
            </li>
            <li>
              Open{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>
              , click <span className="font-medium text-foreground">Add webhook</span>, paste your URL,
              and tick the <a href="#events" className="text-primary underline">events</a> you want.
            </li>
            <li>
              Save, then <span className="font-medium text-foreground">copy the signing secret</span>{" "}
              (<code>whsec_…</code>) shown once — you need it to verify signatures.
            </li>
            <li>
              Hit <span className="font-medium text-foreground">Send test</span> to fire a sample event
              at your endpoint right now, and check the delivery log for the response code.
            </li>
          </Steps>
          <h3 id="events" className="text-sm font-semibold">Events</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-inset text-left">
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Fires when</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS.map((e) => (
                  <tr key={e.type} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{e.type}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold">Payload</h3>
          <Code>{SAMPLE_PAYLOAD}</Code>
          <h3 className="text-sm font-semibold">Verifying signatures</h3>
          <p className="text-sm text-muted-foreground">
            Each delivery carries <code>X-10xC-Event</code>, <code>X-10xC-Delivery-Id</code>, and{" "}
            <code>X-10xC-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>, signed with the secret shown
            once when the webhook was created. Recompute the HMAC and reject anything stale (replay
            protection):
          </p>
          <Code>{VERIFY_SNIPPET}</Code>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="slack" title="Slack" status="live">
          <p className="text-sm text-muted-foreground">
            Post replies, hot leads, and account-status changes straight into a Slack channel — no
            code, no server. 10xConnect sends to a Slack{" "}
            <span className="font-medium text-foreground">Incoming Webhook</span> URL you paste in.
          </p>
          <h3 className="text-sm font-semibold">In Slack — create the webhook URL</h3>
          <Steps>
            <li>
              Go to{" "}
              <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-primary underline">
                api.slack.com/apps
              </a>{" "}
              → <span className="font-medium text-foreground">Create New App</span> →{" "}
              <em>From scratch</em>, name it “10xConnect”, and pick your workspace.
            </li>
            <li>
              In the app, open <span className="font-medium text-foreground">Incoming Webhooks</span>{" "}
              and toggle it <em>On</em>.
            </li>
            <li>
              Click <span className="font-medium text-foreground">Add New Webhook to Workspace</span>,
              choose the channel to post into, and <em>Allow</em>.
            </li>
            <li>
              Copy the generated URL — it starts with{" "}
              <code>https://hooks.slack.com/services/…</code>.
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">In 10xConnect — connect it</h3>
          <Steps>
            <li>
              Open{" "}
              <Link href="/settings/integrations" className="text-primary underline">
                Settings → Integrations
              </Link>{" "}
              and click <span className="font-medium text-foreground">Connect</span> on the Slack card.
            </li>
            <li>Paste the <code>hooks.slack.com</code> URL. It&apos;s stored encrypted at rest.</li>
            <li>
              Pick which events to post (Reply, Hot lead, Account status change, …) and click{" "}
              <span className="font-medium text-foreground">Connect Slack</span>. A welcome message
              lands in the channel immediately — that confirms the URL works.
            </li>
            <li>
              Later, use <span className="font-medium text-foreground">Test</span> on the card to fire a
              sample, <span className="font-medium text-foreground">Reconfigure</span> to change events,
              or <span className="font-medium text-foreground">Disconnect</span> to stop.
            </li>
          </Steps>
          <p className="text-xs text-muted-foreground">
            If Slack ever revokes the URL, deliveries stop and 10xConnect notifies you in-app to
            reconnect.
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="zapier" title="Zapier" status="live">
          <p className="text-sm text-muted-foreground">
            No custom connector needed — Zapier&apos;s built-in{" "}
            <span className="font-medium text-foreground">Webhooks by Zapier</span> app talks to
            10xConnect in both directions.
          </p>
          <h3 className="text-sm font-semibold">10xConnect → anywhere (trigger)</h3>
          <Steps>
            <li>
              In a new Zap, choose <em>Webhooks by Zapier → Catch Hook</em> as the trigger and copy the
              custom webhook URL Zapier gives you.
            </li>
            <li>
              In{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>
              , add that URL and subscribe to the events you want (e.g. <code>reply</code>).
            </li>
            <li>
              Back in Zapier, hit <em>Test trigger</em> (or use{" "}
              <span className="font-medium text-foreground">Send test</span> in 10xConnect), then map
              fields into your next step — Slack, HubSpot, Google Sheets, anything.
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">Anywhere → 10xConnect (action)</h3>
          <Steps>
            <li>
              Add a <em>Webhooks by Zapier → POST</em> action.
            </li>
            <li>
              Set the URL to a REST endpoint, e.g.{" "}
              <code>{API_BASE}/campaigns/CAMPAIGN_ID/leads</code>.
            </li>
            <li>
              Add a header <code>Authorization: Bearer 10xc_…</code> and send JSON — new Calendly
              bookings or Sheet rows flow straight into a campaign.
            </li>
          </Steps>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="n8n" title="n8n" status="beta">
          <p className="text-sm text-muted-foreground">
            Two ways to use n8n. The generic path works today with zero install; the branded node is a
            convenience wrapper we ship in-repo (not yet on npm).
          </p>
          <h3 className="text-sm font-semibold">Option A — generic nodes (works now)</h3>
          <Steps>
            <li>
              <span className="font-medium text-foreground">Trigger:</span> drop a{" "}
              <em>Webhook</em> node, copy its Production URL, and register it in{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>
              .
            </li>
            <li>
              <span className="font-medium text-foreground">Actions:</span> use the{" "}
              <em>HTTP Request</em> node against <code>{API_BASE}/…</code> with a Header Auth credential{" "}
              <code>Authorization: Bearer 10xc_…</code>.
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">Option B — branded community node (beta)</h3>
          <p className="text-sm text-muted-foreground">
            <code>n8n-nodes-10xconnect</code> bundles a credential type, an action node (campaigns /
            leads / conversations), and a trigger node that registers its webhook automatically when
            you activate the workflow. It builds and installs locally today; an npm publish is
            pending, so for now copy it into your n8n custom-nodes directory.
          </p>
          <Code>{`# n8n credential ("10xConnect API")
Base URL: ${API_BASE}
API key:  10xc_YOUR_API_KEY   # sent as Authorization: Bearer`}</Code>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="make" title="Make (Integromat)" status="live">
          <p className="text-sm text-muted-foreground">
            Same pattern as Zapier — no custom app needed.
          </p>
          <h3 className="text-sm font-semibold">10xConnect → Make (trigger)</h3>
          <Steps>
            <li>
              Add a <em>Webhooks → Custom webhook</em> module and copy its URL.
            </li>
            <li>
              Register that URL in{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>{" "}
              with the events you want. Each delivery arrives as a JSON bundle you can map downstream.
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">Make → 10xConnect (action)</h3>
          <Steps>
            <li>
              Use an <em>HTTP → Make a request</em> module against a REST endpoint (e.g.{" "}
              <code>{API_BASE}/campaigns/CAMPAIGN_ID/leads</code>).
            </li>
            <li>
              Add the header <code>Authorization: Bearer 10xc_…</code> and send your JSON body.
            </li>
          </Steps>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="clay" title="Clay" status="live">
          <p className="text-sm text-muted-foreground">
            Enrich in Clay, then push finished leads into a campaign — or pull replies back into a Clay
            table. Both directions ride on the same API key + webhooks.
          </p>
          <Steps>
            <li>
              <span className="font-medium text-foreground">Clay → campaign:</span> add an{" "}
              <em>HTTP API</em> column (or a webhook action) that <code>POST</code>s to{" "}
              <code>{API_BASE}/campaigns/CAMPAIGN_ID/leads</code> with the header{" "}
              <code>Authorization: Bearer 10xc_…</code> and the lead&apos;s LinkedIn URL / email in the
              body.
            </li>
            <li>
              <span className="font-medium text-foreground">Replies → Clay:</span> in{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>
              , register your Clay table&apos;s webhook-source URL and subscribe to <code>reply</code>{" "}
              or <code>hot_lead</code> to append rows as conversations start.
            </li>
          </Steps>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="mcp" title="MCP server" status="live">
          <p className="text-sm text-muted-foreground">
            A remote Model Context Protocol server lets Claude, Cursor, or any MCP client manage your
            workspace — list campaigns, check account health, search leads, read conversations,
            pause/resume campaigns, and reply (replies queue through the same safety-governed dispatch
            engine as the app). Read-only keys expose only the read tools.
          </p>
          <h3 className="text-sm font-semibold">Connect it</h3>
          <Steps>
            <li>
              Create an API key in{" "}
              <Link href="/settings/api" className="text-primary underline">
                Settings → API
              </Link>{" "}
              — pick <code>Read-only</code> if the agent should never send.
            </li>
            <li>Add the server to your MCP client with that key (per-client commands below).</li>
            <li>
              Restart the client and confirm the <code>10xconnect</code> tools appear (e.g. ask it to
              “list my campaigns”).
            </li>
          </Steps>
          <h3 className="text-sm font-semibold">Claude Code</h3>
          <Code>{`claude mcp add --transport http 10xconnect ${API_BASE}/mcp \\
  --header "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <h3 className="text-sm font-semibold">Cursor / Claude Desktop (mcp.json)</h3>
          <Code>{MCP_JSON}</Code>
          <p className="text-xs text-muted-foreground">
            The <code>mcp.json</code> block goes in your client&apos;s config — for Claude Desktop
            that&apos;s{" "}
            <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or{" "}
            <code>%APPDATA%\Claude\claude_desktop_config.json</code> (Windows). Clients without native
            header support can proxy via{" "}
            <code>npx mcp-remote {API_BASE}/mcp --header &quot;Authorization:Bearer 10xc_…&quot;</code>.
          </p>
          <h3 className="text-sm font-semibold">Tools</h3>
          <p className="text-sm text-muted-foreground">
            Fifteen tools, each scoped to the key&apos;s workspace. <em>Read</em> tools work with any
            key; <em>write</em> tools require an <code>All</code> key and are hidden from a Read-only
            key entirely.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-inset text-left">
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Access</th>
                  <th className="px-3 py-2 font-medium">Params</th>
                  <th className="px-3 py-2 font-medium">Returns</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((t) => (
                  <tr key={t.tool} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{t.tool}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          t.access === "write"
                            ? "rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                            : "rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400"
                        }
                      >
                        {t.access}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">
                      {t.params}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{t.returns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section id="roadmap" title="CRM & Calendar" status="soon">
          <p className="text-sm text-muted-foreground">
            Native one-click connectors for <span className="font-medium text-foreground">HubSpot,
            Salesforce, Pipedrive, Calendly,</span> and <span className="font-medium text-foreground">Cal.com</span>{" "}
            are on the roadmap — they show as <em>Coming soon</em> in{" "}
            <Link href="/settings/integrations" className="text-primary underline">
              Settings → Integrations
            </Link>{" "}
            and are not connectable yet. You don&apos;t have to wait, though:
          </p>
          <Steps>
            <li>
              <span className="font-medium text-foreground">Sync replies into your CRM</span> today by
              subscribing to <code>reply</code> / <code>hot_lead</code> webhooks and mapping them with{" "}
              <a href="#zapier" className="text-primary underline">Zapier</a> or{" "}
              <a href="#make" className="text-primary underline">Make</a> into a HubSpot/Salesforce/
              Pipedrive contact or deal.
            </li>
            <li>
              <span className="font-medium text-foreground">Enroll CRM/calendar leads</span> by POSTing
              to <code>{API_BASE}/campaigns/CAMPAIGN_ID/leads</code> from a Calendly/CRM automation with
              your API key.
            </li>
          </Steps>
          <p className="text-xs text-muted-foreground">
            Want one prioritized? Tell us in the{" "}
            <Link href="/community" className="text-primary underline">
              community
            </Link>
            .
          </p>
        </Section>
      </div>

      <footer className="mt-14 border-t pt-6 text-xs text-muted-foreground">
        Questions or a missing endpoint?{" "}
        <Link href="/community" className="text-primary underline">
          Ask in the community
        </Link>
        . Manage keys in{" "}
        <Link href="/settings/api" className="text-primary underline">
          Settings → API
        </Link>
        , webhooks in{" "}
        <Link href="/settings/webhooks" className="text-primary underline">
          Settings → Webhooks
        </Link>
        , and Slack in{" "}
        <Link href="/settings/integrations" className="text-primary underline">
          Settings → Integrations
        </Link>
        .
      </footer>
    </div>
  );
}
