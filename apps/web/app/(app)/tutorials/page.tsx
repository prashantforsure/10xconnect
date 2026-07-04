// In-app integration tutorials (authed): step-by-step "connect it yourself"
// walkthroughs for API keys, Slack, MCP, webhooks, and the n8n node. Static
// content — deep-links into the real settings pages (the user is logged in
// here) and out to the public /developers reference for full detail.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tutorials — 10xConnect",
  description: "Step-by-step guides to connect 10xConnect to Slack, MCP, webhooks, Zapier, and n8n.",
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

const GUIDES: Array<{ id: string; title: string }> = [
  { id: "api-key", title: "Create your first API key" },
  { id: "slack", title: "Connect Slack" },
  { id: "mcp", title: "Set up MCP (Claude / Cursor)" },
  { id: "webhooks", title: "Receive events with webhooks" },
  { id: "n8n", title: "Install the n8n node" },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-inset p-4 text-xs leading-relaxed text-muted-foreground">
      {children}
    </pre>
  );
}

function Guide({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="flex items-center gap-3 text-[15px] font-semibold tracking-tight">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/[0.14] text-sm font-semibold text-indigo-text">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function TutorialsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <p className="eyebrow">Tutorials</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Connect your stack
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Short, copy-paste walkthroughs for wiring 10xConnect into Slack, AI assistants, and your
          automation tools. For the full API + webhook reference, see the{" "}
          <Link href="/developers" target="_blank" className="text-primary underline">
            developer docs
          </Link>
          .
        </p>
        <nav aria-label="Guides" className="mt-4 flex flex-wrap gap-2 text-xs">
          {GUIDES.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {g.title}
            </a>
          ))}
        </nav>
      </header>

      <div className="space-y-5">
        <Guide n={1} id="api-key" title="Create your first API key">
          <p className="text-sm text-muted-foreground">
            An API key is how every integration authenticates. It&apos;s scoped to this workspace, so
            there&apos;s no other setup.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Open{" "}
              <Link href="/settings/api" className="text-primary underline">
                Settings → API
              </Link>{" "}
              and click <span className="font-medium text-foreground">Generate key</span>.
            </li>
            <li>
              Name it after where it&apos;ll live (e.g. <code>Zapier</code>, <code>n8n</code>,{" "}
              <code>MCP</code>) and pick a permission: <span className="font-medium text-foreground">All</span>{" "}
              (read + write) or <span className="font-medium text-foreground">Read-only</span>.
            </li>
            <li>
              Copy the <code>10xc_…</code> key <span className="font-medium text-foreground">now</span> —
              it&apos;s shown only once. Store it like a password.
            </li>
            <li>Send it as a bearer token on every request:</li>
          </ol>
          <Code>{`curl ${API_BASE}/campaigns \\
  -H "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <p className="text-xs text-muted-foreground">
            Read-only keys are rejected on writes; billing, workspace, and key management are never
            reachable with a key.
          </p>
        </Guide>

        <Guide n={2} id="slack" title="Connect Slack">
          <p className="text-sm text-muted-foreground">
            Get a message in Slack the moment a lead replies, an invite is accepted, or an account
            hits a snag.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              In Slack: <span className="font-medium text-foreground">Apps → Incoming Webhooks →
              Add to Slack</span>, pick a channel, and copy the webhook URL (
              <code>https://hooks.slack.com/services/…</code>).
            </li>
            <li>
              In 10xConnect, open{" "}
              <Link href="/settings/integrations" className="text-primary underline">
                Settings → Integrations
              </Link>{" "}
              and click <span className="font-medium text-foreground">Connect</span> on the Slack
              card.
            </li>
            <li>
              Paste the URL, choose which events to post, and click{" "}
              <span className="font-medium text-foreground">Connect Slack</span>. The URL is stored
              encrypted.
            </li>
            <li>
              A welcome message confirms it worked. Use{" "}
              <span className="font-medium text-foreground">Test</span> to send a sample, or{" "}
              <span className="font-medium text-foreground">Reconfigure / Disconnect</span> anytime.
            </li>
          </ol>
        </Guide>

        <Guide n={3} id="mcp" title="Set up MCP (Claude / Cursor)">
          <p className="text-sm text-muted-foreground">
            The MCP server lets Claude, Cursor, or any MCP client manage your workspace in
            natural language — list campaigns, check account health, read the inbox, and (with an{" "}
            <code>All</code> key) pause campaigns or reply.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Create a key in{" "}
              <Link href="/settings/api" className="text-primary underline">
                Settings → API
              </Link>{" "}
              — <code>All</code> for full control, <code>Read-only</code> to expose just the read
              tools.
            </li>
            <li>Claude Code — one command:</li>
          </ol>
          <Code>{`claude mcp add --transport http 10xconnect ${API_BASE}/mcp \\
  --header "Authorization: Bearer 10xc_YOUR_API_KEY"`}</Code>
          <p className="text-sm text-muted-foreground">
            Cursor / Claude Desktop — add this to your MCP config (<code>mcp.json</code>, or Claude
            Desktop&apos;s <code>claude_desktop_config.json</code>):
          </p>
          <Code>{`{
  "mcpServers": {
    "10xconnect": {
      "url": "${API_BASE}/mcp",
      "headers": { "Authorization": "Bearer 10xc_YOUR_API_KEY" }
    }
  }
}`}</Code>
          <p className="text-xs text-muted-foreground">
            Restart the client, then try “list my campaigns.” Full tool list:{" "}
            <Link href="/developers#mcp" target="_blank" className="text-primary underline">
              developers → MCP server
            </Link>
            .
          </p>
        </Guide>

        <Guide n={4} id="webhooks" title="Receive events with webhooks">
          <p className="text-sm text-muted-foreground">
            Push events to your own server, Zapier, Make, or n8n as they happen.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Open{" "}
              <Link href="/settings/webhooks" className="text-primary underline">
                Settings → Webhooks
              </Link>
              , add a name + endpoint URL, and tick the events you want.
            </li>
            <li>
              Copy the <code>whsec_…</code> signing secret (shown once). Verify each delivery with the{" "}
              <code>X-10xC-Signature</code> header —{" "}
              <Link href="/developers#webhooks" target="_blank" className="text-primary underline">
                snippet here
              </Link>
              .
            </li>
            <li>
              Hit <span className="font-medium text-foreground">Test</span> to fire a sample, then
              open the delivery <span className="font-medium text-foreground">Log</span> to watch it
              land. We retry failed deliveries with backoff for ~24 hours.
            </li>
            <li>
              No server of your own? Point the endpoint at{" "}
              <span className="font-medium text-foreground">Webhooks by Zapier</span> (Catch Hook),
              Make (Custom webhook), or an n8n <em>Webhook</em> node — see the{" "}
              <Link href="/developers#zapier" target="_blank" className="text-primary underline">
                recipes
              </Link>
              .
            </li>
          </ol>
        </Guide>

        <Guide n={5} id="n8n" title="Install the n8n node">
          <p className="text-sm text-muted-foreground">
            The community node bundles a credential, an action node (campaigns / leads /
            conversations), and a trigger node that registers a webhook for you. It ships from this
            repo (not yet on npm), so install it as a self-hosted custom node:
          </p>
          <Code>{`# 1. Build the package from the repo
pnpm --filter n8n-nodes-10xconnect build

# 2. Copy it into your n8n custom folder and install runtime deps
cp -r packages/n8n-nodes-10xconnect ~/.n8n/custom/n8n-nodes-10xconnect
cd ~/.n8n/custom/n8n-nodes-10xconnect && npm install --omit=dev

# 3. Restart n8n`}</Code>
          <p className="text-sm text-muted-foreground">
            In n8n, create the <span className="font-medium text-foreground">10xConnect API</span>{" "}
            credential:
          </p>
          <Code>{`Base URL: ${API_BASE}
API key:  10xc_YOUR_API_KEY`}</Code>
          <p className="text-xs text-muted-foreground">
            Prefer no install? The generic <em>HTTP Request</em> + <em>Webhook</em> nodes work with
            the same key — see the{" "}
            <Link href="/developers#n8n" target="_blank" className="text-primary underline">
              n8n guide
            </Link>
            .
          </p>
        </Guide>
      </div>

      <footer className="mt-8 border-t pt-6 text-xs text-muted-foreground">
        Full API reference, event payloads, and signature verification live in the{" "}
        <Link href="/developers" target="_blank" className="text-primary underline">
          developer docs
        </Link>
        . Questions? Ask in the{" "}
        <Link href="/community" className="text-primary underline">
          community
        </Link>
        .
      </footer>
    </div>
  );
}
