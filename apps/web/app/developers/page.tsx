// PUBLIC developer docs (outside the (app) group — no auth, no shell): the
// curated reference for the public API, webhooks (events, payloads, signature
// verification), Zapier/n8n/Make recipes, and the MCP server. Hand-written on
// purpose (no Swagger): this is the STABLE subset we commit to; undocumented
// routes may change without notice.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "10xConnect — Developers",
  description:
    "Public API, webhooks, Zapier/n8n recipes, and the MCP server for 10xConnect.",
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

const ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: "GET", path: "/campaigns", note: "List campaigns with status + lead counts" },
  { method: "GET", path: "/campaigns/:id", note: "Campaign detail" },
  { method: "POST", path: "/campaigns/:id/start", note: "Run a campaign" },
  { method: "POST", path: "/campaigns/:id/pause", note: "Pause (freeze in place)" },
  { method: "POST", path: "/campaigns/:id/resume", note: "Resume a paused campaign" },
  { method: "POST", path: "/campaigns/:id/leads", note: "Enroll leads into a campaign" },
  { method: "GET", path: "/campaigns/:id/analytics", note: "Requests, accepts (+%), replies (+%)" },
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

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border bg-secondary/40 p-4 text-xs leading-relaxed">
      {children}
    </pre>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-primary">
          10xConnect
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Developers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything you need to plug 10xConnect into your stack: a workspace-scoped REST API,
          signed webhooks, Zapier/n8n/Make recipes, and a remote MCP server for AI agents.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2 text-xs">
          {[
            ["#auth", "Authentication"],
            ["#api", "REST API"],
            ["#webhooks", "Webhooks"],
            ["#zapier", "Zapier"],
            ["#n8n", "n8n"],
            ["#mcp", "MCP server"],
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
        <Section id="auth" title="Authentication">
          <p className="text-sm text-muted-foreground">
            Create an API key in <span className="font-medium text-foreground">Settings → API</span>{" "}
            (choose <code>All</code> or <code>Read-only</code>). Each key is scoped to ONE
            workspace — no <code>X-Workspace-Id</code> header needed. Send it as a bearer token:
          </p>
          <Code>{`curl ${API_BASE}/campaigns \\
  -H "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Rate limit: 60 requests/minute per key (429 with a Retry-After hint).</li>
            <li>
              <code>Read-only</code> keys are rejected on any non-GET request.
            </li>
            <li>
              Billing, workspace/member management, and key management are never reachable with an
              API key — use the app for those.
            </li>
          </ul>
        </Section>

        <Section id="api" title="REST API">
          <p className="text-sm text-muted-foreground">
            Base URL: <code>{API_BASE}</code>. JSON in, JSON out. The routes below are the stable,
            documented subset (other routes exist but may change without notice). Every write is
            idempotent at the dispatch layer — a retried send never double-messages a lead, and all
            sends respect the account&apos;s rate caps and working-hours schedule.
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-secondary/40 text-left">
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
        </Section>

        <Section id="webhooks" title="Webhooks">
          <p className="text-sm text-muted-foreground">
            Configure endpoints in <span className="font-medium text-foreground">Settings →
            Webhooks</span> (or via <code>POST /webhooks</code> — that&apos;s how the n8n trigger
            registers itself). We POST a JSON envelope on every subscribed event and retry with
            backoff for ~24 hours (6 retries). After 20 consecutive failures the webhook is
            disabled and you&apos;re notified in-app.
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-secondary/40 text-left">
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
            <code>X-10xC-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>, signed with the secret
            shown once when the webhook was created:
          </p>
          <Code>{VERIFY_SNIPPET}</Code>
        </Section>

        <Section id="zapier" title="Zapier">
          <p className="text-sm text-muted-foreground">
            Use the built-in <span className="font-medium text-foreground">Webhooks by Zapier</span>{" "}
            app — no custom connector needed:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Trigger (10xConnect → anywhere):</span>{" "}
              in Zapier pick <em>Webhooks by Zapier → Catch Hook</em>, copy the hook URL, and add it
              in Settings → Webhooks with the events you want (e.g. <code>reply</code> →
              Slack/HubSpot/Sheets).
            </li>
            <li>
              <span className="font-medium text-foreground">Action (anywhere → 10xConnect):</span>{" "}
              pick <em>Webhooks by Zapier → POST</em>, set the URL to e.g.{" "}
              <code>{API_BASE}/campaigns/CAMPAIGN_ID/leads</code>, and add the header{" "}
              <code>Authorization: Bearer 10xc_…</code> — new Calendly bookings or Sheet rows flow
              straight into a campaign.
            </li>
          </ol>
        </Section>

        <Section id="n8n" title="n8n">
          <p className="text-sm text-muted-foreground">
            Two options: the generic <em>Webhook</em> node (as a trigger — register its URL in
            Settings → Webhooks) plus the <em>HTTP Request</em> node with your bearer key (as
            actions), or install our community node package{" "}
            <code>n8n-nodes-10xconnect</code> which bundles a credential type, an action node
            (campaigns / leads / conversations), and a trigger node that registers webhooks
            automatically when you activate the workflow.
          </p>
          <Code>{`# n8n credential ("10xConnect API")
Base URL: ${API_BASE}
API key:  10xc_YOUR_API_KEY   # sent as Authorization: Bearer`}</Code>
        </Section>

        <Section id="mcp" title="MCP server">
          <p className="text-sm text-muted-foreground">
            A remote Model Context Protocol server lets Claude, Cursor, or any MCP client manage
            your workspace — list campaigns, check account health, search leads, read conversations,
            pause/resume campaigns, and reply (replies queue through the same safety-governed
            dispatch engine as the app). Read-only keys expose only the read tools.
          </p>
          <h3 className="text-sm font-semibold">Claude Code</h3>
          <Code>{`claude mcp add --transport http 10xconnect ${API_BASE}/mcp \\
  --header "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <h3 className="text-sm font-semibold">Cursor / Claude Desktop (mcp.json)</h3>
          <Code>{MCP_JSON}</Code>
          <p className="text-xs text-muted-foreground">
            Clients without native header support can proxy via{" "}
            <code>npx mcp-remote {API_BASE}/mcp --header &quot;Authorization:Bearer 10xc_…&quot;</code>.
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
        .
      </footer>
    </div>
  );
}
