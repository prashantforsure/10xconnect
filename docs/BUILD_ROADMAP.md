# Build Roadmap — Claude Code

A dependency-ordered, step-by-step plan to build the platform with Claude Code. Pair this with `CLAUDE.md` (the standing context). Work **one step per prompt** (big steps are pre-split; some may still take 2–3 prompts). After each step: run it, verify the "Done when", commit, and update `CLAUDE.md`/docs if anything changed.

**Golden ordering rule:** build the **safety brain (rate governor + scheduler + health)** *before* wiring any campaign to actually send. Use the **mock adapter** to develop and test everything end-to-end without touching a real LinkedIn account until late.

**Channel scope:** Phases 0–10 ship **LinkedIn-only parity** (the first product). **Email is Phase 11**, after parity ships. Part B differentiators are a separate plan.

Legend: 🛑 = milestone (stop, integrate, demo).

---

## Phase 0 — Foundation
*Goal: a running monorepo with auth, DB, and an empty app shell.*

**Step 1 — Monorepo scaffold + tooling**
Builds: turborepo + pnpm workspaces (`apps/web`, `apps/api`, `apps/worker`, `packages/core|adapters|db|config`); TS strict, ESLint, Prettier, env validation, base scripts.
Done when: `pnpm dev` boots web + api; `pnpm lint`/`build` pass. Needs: —

**Step 2 — Supabase + Auth**
Builds: Supabase project wiring; Supabase Auth (signup, login, logout, session, password reset) in web + api.
Done when: a user can sign up, log in, and hit an authenticated API route. Needs: 1

**Step 3 — Core DB schema + migrations + RLS**
Builds: Postgres schema for all core entities (§10 of CLAUDE.md), migrations, RLS policies, `workspace_id` scoping, generated TS types.
Done when: migrations apply cleanly; generated types import in `packages/db`; RLS blocks cross-workspace reads. Needs: 2

**Step 4 — API skeleton + web shell**
Builds: NestJS module structure, auth guard, workspace-scoping middleware, error model; Next.js app layout, nav (Dashboard/Campaigns/Contacts/Inbox/Settings + bottom nav), routing skeleton.
Done when: protected routes enforce auth + workspace; nav renders all top-level pages (empty). Needs: 3

---

## Phase 1 — Workspaces & team
*Goal: multi-tenancy users can actually use.*

**Step 5 — Workspaces (CRUD + switcher + General settings)**
Builds: create/rename/delete workspace, workspace switcher, `/settings/general` (name, inbox type, auto-withdraw-after-N-days).
Done when: a user creates/switches workspaces; data is isolated. Needs: 4

**Step 6 — Members & roles (RBAC)**
Builds: invite members (unlimited, free), roles (Owner/Admin/Member), `/settings/members`, permission checks.
Done when: an invited member sees only permitted workspaces with correct permissions. Needs: 5

---

## Phase 2 — Transport layer
*Goal: a clean, swappable connectivity boundary + connected accounts.*

**Step 7 — ChannelAdapter interface + domain types**
Builds: the `ChannelAdapter` interface and all shared types (ActionResult, AccountStatus, EnrichedProfile, events) in `packages/core`.
Done when: interface compiles and is the only contract the app/orchestration layers reference. Needs: 4

**Step 8 — Mock adapter**
Builds: an in-memory `ChannelAdapter` implementation (fake sends, fake profiles, simulated inbound events) for local dev + tests.
Done when: the mock satisfies the full interface and can simulate replies/accepts on demand. Needs: 7

**Step 9 — Unipile adapter**
Builds: real `ChannelAdapter` over Unipile (connect, all sends incl. voice note + InMail, fetchProfile, fetchConversation, inbound webhook subscription) in `packages/adapters/unipile`.
Done when: behind a feature flag, the app can send a test action and receive an inbound webhook via Unipile. Needs: 7

**Step 10 — Account connection: credentials flow**
Builds: credentials connect (country, email/password, 2FA guidance, proxy = bundled|own), `sending_accounts` persistence, warm-up state init; accounts API.
Done when: an account connects via credentials and is stored with status `warming`. Needs: 9

**Step 11 — Account connection: extension flow + Accounts UI**
Builds: browser-extension connect path; `/settings/accounts` (Add a LinkedIn account, list with name/country/status/health, disconnect).
Done when: both connect methods work; accounts list shows live status. Needs: 10

---

## Phase 3 — Leads, enrichment & CRM
*Goal: get leads in and managed.*

**Step 12 — Import pipeline + CSV source + dedupe**
Builds: import job framework, CSV import, workspace dedupe, enrich-status tracking.
Done when: a CSV of profiles imports into a list, deduped. Needs: 5 (and 7 for enrichment types)

**Step 13 — LinkedIn import sources + lead finder**
Builds: import from LinkedIn search URL, Sales Navigator URL, event, post (likers/commenters), group, existing list; built-in lead finder (filters + keywords). Optionally enroll directly into a campaign.
Done when: each source produces leads via the adapter. Needs: 12, 9

**Step 14 — Enrichment service**
Builds: async enrichment via `fetchProfile` (headline, about, company, role, recent posts, connection degree), status updates, retries.
Done when: imported leads auto-enrich; failures surface a status. Needs: 12, 9

**Step 15 — Contacts/CRM UI**
Builds: `/contacts` — lists sidebar, search, filters, custom columns, list/board views, tags, bulk actions, import modal.
Done when: a user can filter, multi-select, tag, and enroll contacts. Needs: 13, 14

---

## Phase 4 — Orchestration brain (safety-critical) 🛑
*Goal: the engine that keeps accounts safe. Build before any live sending.*

**Step 16 — Rate governor**
Builds: per-account, per-action-type daily caps via Redis token buckets; aggregation across all campaigns; hard ceiling/clamp with warnings.
Done when: caps are enforced across concurrent campaigns; over-cap requests blocked; over-ceiling settings clamped. Needs: 8

**Step 17 — Warm-up ramp state machine**
Builds: new-account escalation from reduced caps to full over 4–6 weeks, integrated with the governor.
Done when: a fresh account cannot send at full volume on day 1. Needs: 16

**Step 18 — Scheduler**
Builds: per-weekday working-hours windows (UTC), randomized ~15-min jittered dispatch spacing, timezone handling.
Done when: actions only fire inside the window with no bursts. Needs: 16

**Step 19 — Dispatch worker + job queue**
Builds: BullMQ worker that pulls due actions, checks governor + schedule, calls the adapter, records `actions` idempotently (no double-send), retries safely.
Done when: queued actions dispatch correctly under caps/schedule on the mock adapter, idempotently. Needs: 17, 18

**Step 20 — Account-health monitor + restriction handling 🛑**
Builds: track acceptance/reply rates + restriction/captcha events → health score; restriction detection → auto-pause + notify + reroute; auto-withdraw pending invites after N days.
Done when: a simulated restriction auto-pauses the account within one dispatch cycle and reroutes. Needs: 19

---

## Phase 5 — Sequence engine & campaigns
*Goal: build, save, and run multi-step campaigns.*

**Step 21 — Campaign CRUD + General settings**
Builds: create/list/detail/delete campaigns; settings (skip-already-contacted, exclude-conn-req-from-reply-rate); status badges.
Done when: campaigns persist with settings and status. Needs: 5

**Step 22 — Per-campaign Frequency + Schedule settings**
Builds: Frequency (caps) and Schedule (per-day UTC hours) editors wired to governor + scheduler.
Done when: editing caps/schedule changes dispatch behavior. Needs: 21, 16, 18

**Step 23 — Sequence engine: action executors**
Builds: graph model + per-lead state machine; executors for all 12 action nodes (connection request no-note, message, voice note, comment, like, visit, InMail, add tag, reply comment, message-to-open-profile, follow, wait).
Done when: a linear action sequence executes per lead on the mock adapter. Needs: 19

**Step 24 — Sequence engine: conditions + branching + auto-stop**
Builds: condition executors (has-URL, 1st-level, message-opened, open-profile, check-data-in-column, invite-accepted, message-replied) with true/false branching; reply-driven auto-stop.
Done when: branches resolve correctly and a simulated reply halts the lead's sequence. Needs: 23, 8

**Step 25 — Builder UI: canvas + node palette**
Builds: React Flow canvas, "Start the campaign" node, +Add action / +Add condition modals, per-node config forms.
Done when: a user can visually assemble a sequence graph. Needs: 21

**Step 26 — Builder UI: persistence + run/stop + Leads tab + Share**
Builds: save/load graph (`PUT /campaigns/:id/sequence`), Run it!/Stop, status, Leads tab (enrolled leads + stage), Share link.
Done when: a saved graph runs and shows per-lead progress. Needs: 25, 23, 24

**Step 27 — 🛑 First end-to-end dry run (mock adapter)**
Builds: nothing new — integrate. Enroll leads → run the canonical default sequence → verify caps/schedule/branching/auto-stop end-to-end on the mock.
Done when: a full campaign completes a dry run with correct safety behavior. Needs: 26, 20

---

## Phase 6 — AI personalization & voice
*Goal: the messaging quality layer.*

**Step 28 — AI personalization engine**
Builds: profile → editable prompt → personalized observation; prompt library + brand-voice templates; variable injection ({first_name}, {company}, custom columns); preview-before-send across sample leads. Wire into message/comment nodes.
Done when: preview generates distinct observations across leads; prompt edits re-preview. Needs: 14, 23

**Step 29 — Voice cloner setup**
Builds: `/settings/voice-cloner` — record/upload training audio → generate clone → preview; store `voice_profiles`.
Done when: a user can create and preview a voice clone. Needs: 5

**Step 30 — Voice note nodes**
Builds: voice-note node config — recorded/uploaded (per-segment) + AI-clone (per-prospect variables); native voice-note send via adapter; auto-append context text; ≤30s guardrail; preview.
Done when: per-prospect cloned notes preview correctly and send on the mock. Needs: 28, 29, 23

---

## Phase 7 — Inbox
*Goal: manage replies; close the loop.*

**Step 31 — Inbound events → conversations + auto-stop wiring**
Builds: webhook handler maps inbound events to `conversations`/`messages`; reply → auto-stop; inbox-type extraction (all vs campaign-only).
Done when: an inbound reply appears as a conversation and halts the campaign. Needs: 9 (or 8), 24

**Step 32 — Unified inbox UI**
Builds: `/inbox` — inbox-type selection modal, conversation list across accounts, thread view, reply, lead side-panel, saved responses, pipeline stages, snooze, tags.
Done when: a user can read and reply to a conversation; stage/tag it. Needs: 31

---

## Phase 8 — Analytics
*Goal: visibility into performance + account safety.*

**Step 33 — Audit log + per-campaign analytics**
Builds: `actions` audit log (Past Actions); campaign metrics (requests, conversations, open messages, likes, comments, accepted-invite %, replies %, InMails).
Done when: campaign analytics reconcile with the action log. Needs: 19

**Step 34 — Dashboard + account safety analytics**
Builds: workspace dashboard (Connections, Conversations, Engagements, InMails, Tags) with date + campaign filters + export; per-account safety analytics (acceptance, volume vs caps, health).
Done when: dashboard renders accurate aggregates and exports. Needs: 33, 20

---

## Phase 9 — Commercial & public-facing
*Goal: the public site, monetization, and onboarding — the full visitor → signup → first campaign funnel.*

**Step 35 — Billing: slot model + status UI**
Builds: per-sending-account slot model, `/settings/billing` (subscription status, active/free slots, current cost, annual|monthly toggle, slot slider, what's-included).
Done when: slot counts and subscription status display correctly. Needs: 11

**Step 36 — Billing: Creem/Dodo checkout + webhooks**
Builds: checkout (annual|monthly), payment webhooks (activate/cancel/update slots), trial handling; keep provider behind an interface + a backup-provider seam.
Done when: a test purchase activates the subscription and updates slots. Needs: 35

**Step 37 — Landing / home page**
Builds: public marketing home page — hero + value prop, feature sections (LinkedIn + email outreach, AI personalization, voice notes, account safety), pricing section reflecting the slot tiers, social proof/testimonials placeholder, FAQ, primary CTAs → signup, footer; responsive, SEO/meta tags, fast static rendering.
Done when: the landing page renders publicly (unauthenticated), is responsive, and its CTAs route to signup. Needs: 2 (signup CTA); 36 (accurate pricing + checkout link). *Can be pulled earlier as a static page if you want a waitlist sooner.*

**Step 38 — Public pricing + legal pages**
Builds: dedicated public pricing page (tiers, slot slider, annual|monthly, FAQ), plus privacy policy, terms of service, and about/contact pages; consistent marketing layout/footer.
Done when: pricing + legal pages render publicly and link correctly from the landing page and footer. Needs: 36, 37

**Step 39 — Onboarding flow + dashboard checklist**
Builds: `/onboarding` (Extension or Credentials → connect → next), dashboard "Let's get started" checklist (connect account ✓, create campaign).
Done when: a new user reaches a running first campaign through the guided flow. Needs: 11, 26

---

## Phase 10 — Extensibility & agency
*Goal: open it up and support agencies.*

**Step 40 — Public API + API keys + outbound webhooks**
Builds: workspace API keys, public REST endpoints (per §8 of CLAUDE.md), outbound webhooks (reply/accept/status events).
Done when: an external call with an API key works; a reply fires an outbound webhook. Needs: 31, 21

**Step 41 — Integrations**
Builds: CRM sync (HubSpot/Salesforce/Pipedrive), calendar (Calendly/Cal.com), Slack alerts, Zapier/Make.
Done when: at least one CRM and calendar integration round-trips. Needs: 40

**Step 42 — Team/agency/white-label + affiliate**
Builds: manage many client workspaces, white-label domain/branding, client-shareable reports; affiliate dashboard.
Done when: a white-label workspace renders agency branding; client report shares. Needs: 6, 34

---

## Phase 11 — Email channel (after LinkedIn parity ships)
*Goal: add the co-equal channel that's Prosp's gap.*

**Step 43 — Email transport**
Builds: mailbox connect (Gmail/Outlook/IMAP-SMTP), `sendEmail`, email-thread fetch via the adapter; `mailboxes` entities.
Done when: an email sends and a reply syncs via the adapter. Needs: 7

**Step 44 — Email deliverability**
Builds: multiple domains/mailboxes, domain + mailbox warm-up, SPF/DKIM/DMARC setup wizard + monitoring, mailbox rotation, bounce/spam/blocklist monitoring with auto-pause, list verification, one-click unsubscribe.
Done when: warm-up runs and deliverability drops auto-pause sending. Needs: 43

**Step 45 — Email in builder + inbox**
Builds: email action nodes (send_email, email_followup) + email condition nodes (opened/clicked/bounced); unified inbox includes email threads; true cross-channel sequences.
Done when: a LinkedIn+email sequence runs and email replies appear in the inbox. Needs: 43, 26, 32

---

## Phase 12 — Hardening & launch 🛑
*Goal: safe, observable, deployable.*

**Step 46 — Compliance**
Builds: GDPR/CAN-SPAM helpers, opt-out handling, suppression/do-not-contact lists, data export/delete.
Done when: opt-outs and suppression are enforced across sending. Needs: 31

**Step 47 — Observability + safety tests**
Builds: Sentry, structured logs/metrics, alerts (restriction spikes, rate breaches, deliverability drops); thorough tests for governor/scheduler/engine; dispatch load test.
Done when: alerts fire on simulated incidents; safety-critical components have strong test coverage. Needs: 20, 33

**Step 48 — 🛑 Security/RLS audit + CI/CD + deploy**
Builds: RLS audit, secrets management, CI pipeline, deploy to Render/Railway + Supabase + Redis; production runbook.
Done when: the app deploys to production with passing CI and a clean security/RLS review. Needs: all

---

## How to use this with Claude Code

1. Paste `CLAUDE.md` at the repo root first (and this file in `/docs`).
2. Work **one step per prompt**. For a big step, ask for the prompt and I'll split it into 2–3 sub-prompts.
3. After each step: run it, verify "Done when", write/extend tests (especially Phase 4 + the engine), commit, and update `CLAUDE.md`/docs if the contract changed.
4. Keep everything behind the **ChannelAdapter**; develop against the **mock adapter** and only flip to Unipile when a step explicitly needs it.
5. Don't skip Phase 4 before Phase 5 — sending without the safety brain risks real account bans.

When you're ready, send me the **step number** and I'll write the exact Claude Code prompt for it.
