Standing context for Claude Code. Read this fully before working in the repo. It defines what we're building, the architecture, the rules you must not break, the full feature set, and every route with its functionality.


v0.2 — verified against the Prosp.ai UI (settings, builder, frequency, schedule, analytics, import, onboarding). Routes now carry per-endpoint functionality.


important note: there will be times when you feel like you want to suggest something better than this file , feel free to do it as we are building a big software there will be time where we have to make changes for better.

1. What we're building

A B2B cold-outreach SaaS for LinkedIn + email — sales teams, founders, and agencies run personalized multi-step campaigns at scale to start conversations and book calls. It is a feature-parity build of Prosp.ai, plus email as a co-equal channel.

Core loop: import/find leads → enrich → run a multi-step sequence (LinkedIn actions + email) with AI-personalized messages and voice notes → auto-stop on reply → manage replies in a unified inbox → book calls.

The #1 priority is account safety, not the AI. The AI personalization is the commoditized, easy part. The make-or-break is not getting users' LinkedIn accounts restricted and keeping email deliverable. Treat every feature through that lens.


2. Non-negotiable principles (do not violate)


Thou shalt not sell (product methodology). Defaults favor starting conversations over pitching. Default message pattern = personalized observation + soft, low-friction question. Connection requests default to no note. Follow-ups switch medium and add value rather than repeat.
Safety over volume. The system must REFUSE to exceed researched safe action limits even when a user asks. Warn and clamp; never silently exceed.
Account death is an expected lifecycle event, not an error. On restriction: auto-pause, notify, reroute where possible, surface remediation. Never crash or silently keep sending.
The Channel Adapter boundary is sacred. App and orchestration layers NEVER call a transport provider SDK (Unipile, ESP) directly. Everything goes through the ChannelAdapter interface (§5).
No double-sends, ever. All dispatch and webhook handling must be idempotent. A duplicate DM or email is an account-safety hazard.
Multi-tenancy: every row is scoped by workspace_id. Every query filters by workspace. Never leak cross-workspace data.
Buying transport ≠ buying safety. Unipile sends what you tell it; the rate governor, scheduler, warm-up, and health monitoring are OURS, in the orchestration layer.
Responsible posture. LinkedIn automation violates LinkedIn ToS; never market guaranteed un-bannability. Include compliance helpers (GDPR/CAN-SPAM, opt-out, suppression lists).



3. Tech stack (locked)

LayerChoiceNotesFrontendReact + TypeScript, Next.js (App Router)Builder UIReact Flownode/edge campaign canvasStylingTailwind + shadcn/uiBackendTypeScript + NestJS(confirm vs team's strongest language)Data + Auth + Realtime + StorageSupabase (Postgres)Auth = Supabase Auth; Realtime = inbox; Storage = voice audioCompute / API / workersRender (or Railway)always-on dispatch workersCache / queueRedis + BullMQrate-governor token buckets; → Temporal when justifiedTransport (LinkedIn + email)Unipile, behind ChannelAdapterbuy now, reversibleAI personalizationLLM API (cheap model)swappableVoice notesTTS / voice-clone providerswappablePaymentsCreem (primary MoR) / Dodo (India+UPI)Stripe-via-US-entity = scale endgameObservabilitySentry + logs/metrics + alertingrestriction spikes, rate breaches, deliverability dropsEdge (optional)CloudflareCDN/WAF


Data access strategy (hybrid — decided after Step 3)

- Web (apps/web): @supabase/supabase-js + RLS. Queries run AS the logged-in user through Supabase's pooler, so tenant isolation is automatic. Use this for all user-facing reads/writes.
- Server / safety engine (apps/api, apps/worker): Kysely — a typed query builder over a direct SERVICE-ROLE connection through the Supavisor transaction pooler (port 6543). Required for transactions + SELECT … FOR UPDATE row locking in the rate governor and idempotent dispatch. Service-role bypasses RLS, so workspace scoping is enforced in a thin repository layer; RLS stays as defense-in-depth.
- Source of truth = SQL migrations in packages/db/supabase/migrations (they carry RLS policies, triggers, SECURITY DEFINER functions). Kysely reuses packages/db/src/database.types.ts (no second schema definition). We do NOT use an ORM that owns the schema (no Drizzle/drizzle-kit migrations).
- DATABASE_URL: session pooler / port 5432 for migrations + session-needing scripts (SET ROLE, multi-statement DDL); transaction pooler / port 6543 for app + worker pooled connections.
- Kysely is introduced when first needed (Step 4 / Phase 4), not before.


4. Repo structure (monorepo, pnpm + turborepo)

apps/
  web/            Next.js frontend (dashboard, campaigns, builder, contacts, inbox, settings)
  api/            NestJS REST API + webhook handlers
  worker/         Dispatch workers (BullMQ): rate governor, scheduler, sequence engine
packages/
  core/           Domain logic: ChannelAdapter interface, sequence engine, rate governor, types
  adapters/       ChannelAdapter implementations (mock/, unipile/, email/) + createChannelAdapter factory (ADAPTER env, default mock) — ONLY place provider SDKs are imported
  db/             Supabase schema, migrations, generated types
  config/         Shared config, env validation

Rule: provider SDKs (Unipile, ESP, LLM, TTS) are imported ONLY inside packages/adapters. Everything else depends on interfaces in packages/core.


5. Architecture

Three layers


Transport — raw connectivity + send/read primitives (proxy, session/auth, fingerprint, raw actions). Unipile / ESP behind the adapter.
Orchestration ("the brain") — sequence engine, per-account rate governor, scheduler, warm-up state machine, reply detection, account-health monitor. WE own this regardless of build-vs-buy.
Application — UI, CRM, inbox, analytics, billing, API.


Adapter interfaces (packages/core) — implemented in Step 7. The transport boundary is split into two interfaces (ISP): ChannelAdapter (LinkedIn) and EmailAdapter (email, Phase 11). They share the same domain types and idempotency/result/event contract. ZERO provider/SDK imports may ever appear in packages/core.

Key contract decisions:
- Structured refs, not bare ids: methods take AccountRef { accountId; providerAccountId? } and LeadRef { leadId; linkedinUrl?; providerId?; email? } so the adapter is DB-free and provider-agnostic while echoing our correlation ids back.
- Idempotency-first: every mutating verb takes opts: SendOptions { idempotencyKey } (ConnectionRequestOptions adds note?, default NO note) and returns ActionResult.
- ActionResult = { status:'success'; idempotencyKey; providerRef?; deduplicated?; at } | { status:'failed'; idempotencyKey; error: ChannelError }. Errors are RETURNED, never thrown as strings.
- ChannelError { code; message; retriable; retryAfterMs?; providerRef?; cause? } with code ∈ rate_limited | account_restricted | account_disconnected | captcha_required | not_connected | lead_not_found | invalid_request | provider_error | timeout | unknown. account_restricted/captcha_required are domain events (§2) — returned, then mapped to auto-pause by orchestration.
- InboundEvent discriminated union { id (provider event id = webhook dedup key); accountId; channel; occurredAt } & ( reply{lead,message} | invite_accepted{lead} | message_opened{lead} | email_opened{lead} | email_clicked{lead,url?} | email_bounced{lead,bounceType?} | account_status_changed{status} ). reply drives auto-stop + inbox.
- ActionType (transport-dispatch subset of §7): connection_request | message | voice_note | inmail | open_profile_message | like_post | comment_post | reply_comment | visit_profile | follow_lead | email. (add_tag / wait_x_days / condition nodes are orchestration-level, not transport.)
- subscribeInboundEvents(handler): Unsubscribe.

ChannelAdapter (LinkedIn): connectAccount, disconnectAccount, getAccountStatus, sendConnectionRequest (no-note default), sendMessage, sendVoiceNote, sendInMail, sendOpenProfileMessage, likePost, commentPost, replyComment, visitProfile, followLead, fetchProfile (enrichment), fetchConversation, subscribeInboundEvents.
EmailAdapter (Phase 11): connectMailbox, getMailboxHealth, sendEmail, subscribeInboundEvents.

Execution model (the dispatch engine — heart of the product)


Actions queued per sending account.
Rate governor enforces per-account, per-action-type daily caps, aggregated across ALL campaigns for that account (not per campaign).
Scheduler dispatches only inside the account's working-hours window, with randomized ~15-minute average spacing (jittered — never burst). UI copy: "Campaigns run automatically in 15-minute intervals on average to avoid detection."
Warm-up state machine ramps new accounts from reduced caps to full over 4–6 weeks.
Inbound events (reply, accepted invite, open) arrive via webhooks → update LeadCampaignState → auto-stop the lead's sequence on reply.
Idempotent: each action has a unique key; retries never double-send.



6. Account safety rules (implement exactly)

Connection methods (onboarding offers both)


Browser extension (preferred): rides the user's real authenticated LinkedIn session.
Credentials: country + email/password + mandatory 2FA guidance; server-side session through a country-matched proxy.
Each account gets a dedicated residential proxy matching the owner's region. Options: "use our free proxy" (bundled) or "use your own proxy".


Default per-account daily caps (per campaign UI; clamp to safe max). Exact Prosp labels:

Action (Prosp label)Default/dayConnection Requests15Messages30InMails5AI Comments (comments are AI-generated)30Likes to posts30Profile visits30Follow Lead30


These nodes consume the Profile-visits budget when used as the first node: is_open_profile, add_tag, invite_accepted, check_data_in_column, message_opened, message_replied. Warn the user and recommend raising the Profile-visits cap when used.
Hard ceiling: reject/clamp any cap above researched safe maxima with a clear warning.


Scheduling & hygiene


Per-weekday working-hours schedule (UTC, toggle per day, time range). Recommend ≥7 hrs/day; warn on very short windows.
Auto-withdraw pending connection requests after N days (default 14) — workspace setting.
Track acceptance rate (top restriction predictor), reply rate, captcha/restriction events → per-account health score.
On detected restriction: auto-pause the account's campaigns within one dispatch cycle, notify, surface remediation; reroute across the user's other healthy accounts where possible.


Email deliverability (EMAIL)


Multiple sending domains/mailboxes; domain + mailbox warm-up; SPF/DKIM/DMARC setup + monitoring; mailbox rotation; bounce/spam/blocklist monitoring with auto-pause on deliverability drop; list verification on import; one-click unsubscribe.



7. Sequence engine — nodes (full set)

A campaign = a list of leads + an ordered graph of timed nodes + an account assignment + a schedule + caps. Per-lead position tracked in LeadCampaignState.currentNodeId.

Action nodes (12, all LinkedIn) + email

send_connection_request (no-note default) · send_message · send_voice_note · comment_last_post (AI comment) · like_last_post · visit_profile · inmail · add_tag · reply_comment · send_message_to_open_profile · follow_lead · wait_x_days · EMAIL: send_email · email_followup

Condition nodes (branching → true/false paths)

has_linkedin_url · is_first_level (Lead is 1st level) · message_opened (Opened LinkedIn Message) · is_open_profile (Lead is Open Profile) · check_data_in_column · invite_accepted (Check if invite accepted) · message_replied (Check if message replied) · EMAIL: email_opened · email_clicked · email_bounced

Canonical default sequence (ship as a template)


like_last_post (warm-up touch)
send_connection_request (no note)
invite_accepted? → on accept → send_message (AI observation + soft question)
wait_x_days (~3)
send_voice_note (recorded or AI-clone) + short context text
if still no reply → light engagement loop: like_last_post → wait → visit_profile → wait → comment_last_post
revisit later with a new angle (months)


At every step a reply auto-stops the sequence and routes the lead to the inbox for human takeover. Dispatch always respects the account schedule + rate governor.

Campaign settings (Settings tab)

name · skip leads already contacted by another campaign (checkbox) · exclude connection-request messages from reply-rate calc (applies to all campaigns, checkbox) · per-action caps (Frequency) · schedule · start ("Run it!") / stop · delete · Share (shareable campaign/template link) · status badge (draft|pending|running|stopped|completed).


8. API routes — /api/v1, with functionality

Auth: bearer (Supabase session) for app; API key per workspace for public API. All routes workspace-scoped. All list endpoints support pagination/filter.

Auth & workspaces


POST /auth/* — handled by Supabase Auth (signup, login, reset). App reads session.
GET /workspaces — list workspaces the user belongs to.
POST /workspaces — create a workspace (becomes Owner).
PATCH /workspaces/:id — update workspace name and settings: inbox_type ('not_configured' | 'all_conversations' | 'campaign_only'), auto_withdraw_days (default 14, clamped 1–90), branding. (Settings are merged, not replaced.) RBAC: workspace:update (Owner/Admin).
DELETE /workspaces/:id — delete workspace and all scoped data. RBAC: workspace:delete (Owner only).
GET /workspaces/:id/members — list members (name, email, role, joinedAt) + pending invites + the caller's role. RBAC: members:read (any member).
POST /workspaces/:id/members — invite by email (unlimited, free). If the email already has an account → membership created immediately; else a pending workspace_invites row is created and resolved on signup (handle_new_user trigger). RBAC: members:invite (Owner/Admin); only an Owner can invite/grant the owner role.
PATCH /workspaces/:id/members/:userId — change role. RBAC: members:update_role (Owner/Admin); assigning/changing the owner role requires Owner; the last Owner can't be demoted.
DELETE /workspaces/:id/members/:userId — remove member. RBAC: members:remove (Owner/Admin); only an Owner removes an Owner; the last Owner can't be removed.
DELETE /workspaces/:id/invites/:inviteId — revoke a pending invite. RBAC: members:invite (Owner/Admin).

RBAC matrix (authoritative copy in packages/core/src/rbac.ts; enforced server-side by WorkspaceRbacGuard, UI gating is secondary):
- Owner: everything — workspace:update/delete, transfer_ownership (grant/modify the owner role), billing:manage, all members:* .
- Admin: workspace:update, members:read/invite/update_role/remove — but NOT delete/billing/ownership, and cannot affect Owners or grant the owner role.
- Member: members:read + product use only.
Invariants: never remove/demote the last Owner; only an Owner can delete the workspace, manage billing, or transfer ownership. Members are unlimited and free (billing is per sending-account slot, not per seat).


Sending accounts (LinkedIn / mailbox) — the safety-critical surface


GET /accounts — list connected accounts with status, location/country, health score.
POST /accounts/connect — connect via extension or credentials (country, email, password, 2FA, proxy = bundled|own). Kicks off warm-up state.
GET /accounts/:id — account detail + settings.
GET /accounts/:id/health — acceptance rate, reply rate, action volume vs caps, restriction/captcha events, health score.
PATCH /accounts/:id — update proxy, per-account schedule overrides, warm-up overrides.
POST /accounts/:id/disconnect — disconnect; pause its campaigns gracefully.
POST /accounts/:id/pause / POST /accounts/:id/resume — manual pause/resume (also triggered automatically on restriction).
EMAIL: POST /mailboxes/connect, GET /mailboxes/:id/health, POST /mailboxes/:id/warmup.


Lead sourcing & contacts (CRM)


POST /leads/import — import from a source: list | linkedin_search | sales_navigator | csv | event | post | group | lead_finder. Optionally enroll directly into a campaign ("Add contacts to campaign"). Triggers async enrichment + dedupe.
POST /leads/find — built-in lead finder: filters + keywords over LinkedIn-derived data.
GET /leads — list/search contacts; supports filters + column selection (list & board views).
GET /leads/:id — contact detail: enrichment, tags, custom columns, campaign membership, conversation.
PATCH /leads/:id — edit fields/tags/custom columns.
DELETE /leads/:id — delete lead from workspace.
POST /leads/:id/enrich — (re)run enrichment (headline, about, company, role, recent posts, connection degree; EMAIL: email finder + verify).
POST /leads/bulk — bulk add/remove to lists/campaigns, bulk tag.
GET /lists · POST /lists · PATCH /lists/:id (name/color) · DELETE /lists/:id — contact lists.


Campaigns & sequence


GET /campaigns — list campaigns with status badges.
POST /campaigns — create campaign (draft).
GET /campaigns/:id — campaign detail (tabs: Leads | Builder | Analytics | Settings).
PATCH /campaigns/:id — settings: name, skip-already-contacted, exclude-conn-req-from-reply-rate.
DELETE /campaigns/:id — delete campaign.
GET /campaigns/:id/sequence — return the node graph (actions + conditions + edges + delays).
PUT /campaigns/:id/sequence — save the builder graph.
POST /campaigns/:id/start — "Run it!" → enqueue leads, begin dispatch within schedule + caps.
POST /campaigns/:id/stop — stop dispatch.
GET /campaigns/:id/status — running/pending/stopped/completed + counts.
GET /campaigns/:id/leads — leads in the campaign with their current stage.
POST /campaigns/:id/leads — enroll leads (respects skip-already-contacted).
DELETE /campaigns/:id/leads/:leadId — remove a lead from the campaign.
GET /campaigns/:id/leads/:leadId/stage — lead's current node/stage + history.
GET /campaigns/:id/settings/frequency — per-action daily caps.
PUT /campaigns/:id/settings/frequency — update caps (clamped to safe max).
GET /campaigns/:id/settings/schedule · PUT /campaigns/:id/settings/schedule — per-weekday working hours (UTC).
POST /campaigns/:id/share — create/get a shareable campaign link (template/collaboration).
GET /campaigns/:id/analytics — campaign metrics (see analytics below).


AI personalization & voice


POST /ai/preview — run the editable personalization prompt across a sample of leads; return generated observations for review before activating.
GET /ai/prompts · POST /ai/prompts — prompt library / brand-voice templates.
POST /voice/clone — train/generate the user's voice clone from uploaded audio.
POST /voice/preview — preview a generated note (with variable injection) before send.
POST /voice/generate — generate a per-prospect cloned note for a list/segment.


Inbox & conversations


GET /conversations — unified inbox across accounts; filter by account/campaign/pipeline-stage; honors inbox type (all vs campaign-only).
GET /conversations/:id — full thread + lead enrichment side panel.
POST /conversations/:id/reply — send a reply via the owning account/channel.
PATCH /conversations/:id — set pipeline stage (new|in_conversation|qualified|booked|lost), tags, snooze.
GET /saved-responses · POST /saved-responses — reusable reply snippets.


Analytics


GET /analytics/workspace — dashboard: Connections, Conversations, Engagements, InMails, Tags; filters (This Week / range, Select Campaigns); export.
GET /analytics/campaign/:id — LinkedIn request, Conversations, Open Messages, Likes, Comments, Accepted Invite (count + %), Replies (count + %), InMail Sent; + Past Actions audit log (time + action).
GET /analytics/accounts — per-account safety analytics (acceptance rate, volume vs caps, health).
EMAIL metrics: sends, opens, clicks, replies, bounces.


Billing


GET /billing/subscription — plan, subscription status (e.g. not_activated/trial/active), active slots / free slots, current monthly cost, annual|monthly.
POST /billing/slots — add/remove sending-account slots (per-account pricing; volume tiers). Campaigns/contacts/messages/members unlimited; bundled proxy per slot. NO metered sending credits.
POST /billing/checkout — start checkout (annual|monthly) via Creem/Dodo.
POST /webhooks/payments — Creem/Dodo subscription webhook (activate/cancel/update slots).


API keys, webhooks, integrations


GET /api-keys · POST /api-keys · DELETE /api-keys/:id — workspace API keys (public API).
GET /webhooks · POST /webhooks · DELETE /webhooks/:id — outbound webhook config (events: reply, accepted_invite, status_change).
POST /webhooks/inbound/unipile — receive inbound transport events (replies, accepts, opens) → drive auto-stop + inbox.
GET /integrations · POST /integrations/:provider/connect — HubSpot/Salesforce/Pipedrive, Calendly/Cal.com, Slack, Zapier/Make.
GET /affiliate — affiliate program dashboard (referral link, payouts).



9. Frontend routes (Next.js App Router) — with functionality

/login  /signup
/onboarding                        # Get started: choose Extension or Credentials → connect → next step; Book a call / Quit
/dashboard                         # onboarding checklist (Connect account ✓, Create campaign); workspace analytics (Connections, Conversations, Engagements, InMails, Tags) w/ date + campaign filters + export
/campaigns                         # campaigns list w/ status badges; Create campaign (empty state CTA)
/campaigns/:id                     # campaign workspace, tabbed:
   ?tab=leads                      #   Leads: imported leads + stage; Import contacts (8 sources); Add contacts to campaign
   ?tab=builder                    #   Builder: React Flow canvas; "Start the campaign" root; +Add action / +Add condition modal; zoom/lock; Run it!; Share
   ?tab=analytics                  #   per-campaign metrics + Past Actions log + 15-min interval notice
   ?tab=settings                   #   General (name, skip-already-contacted, exclude-conn-req-from-reply-rate, delete), Frequency (caps), Schedule (per-day UTC hours)
/contacts                          # CRM: MY LIST sidebar, search, View all contacts, Create new list; Filters; Columns (visibility); list/board view toggle; Import contacts
/contacts/lists/:id                # a single list's contacts
/inbox                             # unified inbox; first-run "Select Inbox Type" modal (Extract all conversations | Only Prosp conversations); thread view + reply + lead panel + saved responses + pipeline stages
/settings/general                  # first/last name, workspace name, inbox type, auto-withdraw-after-14-days, delete workspace
/settings/accounts                 # Connect LinkedIn ("Add a LinkedIn account" → extension|credentials), connected accounts (name, country, status, health, Disconnect)
/settings/members                  # invite/manage members (unlimited, free), roles
/settings/billing                  # subscription status, active/free slots, current cost, Annual|Monthly toggle, per-account slot slider, Buy Slot, what's included, custom pricing CTA
/settings/voice-cloner             # record/upload training audio → generate → preview clone
/settings/white-label              # custom domain + branding for client-facing surfaces
/settings/webhooks                 # outbound webhook endpoints + events
/settings/integrations             # connect HubSpot/Salesforce/Pipedrive, Calendly, Slack, Zapier/Make
/settings/api                      # API key generate/revoke + docs link
# Bottom-nav / utility:
/tutorials   /affiliate   /community   (API docs link external)


10. Data model (core entities — Postgres; workspace_id on all scoped tables)


users — id, email, name, auth (Supabase).
profiles — id (= auth.users.id), email, name (combined display), first_name, last_name. Mirror of auth.users (populated by the handle_new_user trigger; Google OAuth fills first/last from given_name/family_name).
workspaces — id, name, owner_id, settings (jsonb: inbox_type ['not_configured'|'all_conversations'|'campaign_only'], auto_withdraw_days [default 14]), branding (jsonb).
memberships — user_id, workspace_id, role (owner|admin|member). RBAC source of truth; multiple owners allowed (transfer ownership = promote a second owner, then optionally demote the first). workspaces.owner_id stays as the immutable creator pointer.
workspace_invites — id, workspace_id, email, role, invited_by, status (pending|accepted), timestamps. A pending invite for an email is auto-resolved into a membership by handle_new_user when that email signs up. Unique pending invite per (workspace, lower(email)).
sending_accounts — id, workspace_id, type (linkedin|mailbox), connection_method (extension|credentials), proxy (bundled|own + region), location, status (active|warming|paused|restricted|disconnected), health_score, warmup_state.
contact_lists — id, workspace_id, name, color.
leads — id, workspace_id, linkedin_url, email, enrichment (jsonb), tags, custom_columns (jsonb), dedupe_key, enrich_status, connection_degree.
list_leads — list_id, lead_id.
campaigns — id, workspace_id, name, status, account_id, schedule (jsonb), caps (jsonb), settings (jsonb: skip_already_contacted, exclude_conn_req_from_reply_rate), share_token.
sequence_nodes — id, campaign_id, kind (action|condition), type, config (jsonb), next_node_id, true_node_id, false_node_id, delay_days.
lead_campaign_state — lead_id, campaign_id, current_node_id, status, history (jsonb).
conversations — id, workspace_id, account_id, lead_id, channel, pipeline_stage, snooze_until, tags.
messages — id, conversation_id, direction, channel, body, voice_ref, created_at.
actions — id, workspace_id, account_id, lead_id, type, idempotency_key, scheduled_at, executed_at, result. (audit + analytics + dedupe)
voice_profiles — id, user_id, model_ref.
api_keys — id, workspace_id, hash.
webhooks — id, workspace_id, url, events.
subscriptions / billing_slots — workspace_id, slot_count, plan, billing_cycle (monthly|annual), status (not_activated|trial|active|canceled).



11. Non-functional requirements


Security: encrypt credentials/sessions at rest; never log secrets; 2FA encouraged on connected accounts; SOC 2 trajectory.
Safety SLOs: rate governor never exceeds configured caps; restriction detection-to-pause within one dispatch cycle; warm-up cannot be bypassed.
Reliability: idempotent dispatch + webhook processing; no duplicate sends on retry.
Scalability: thousands of accounts + concurrent campaigns; per-account queues scale horizontally.
Compliance: GDPR/CAN-SPAM helpers, opt-out, suppression/do-not-contact lists, data export/delete.
Observability: per-account action logs, health metrics, alerts on restriction spikes + deliverability drops.



12. Conventions & commands


TypeScript everywhere, strict: true; shared types in packages/core.
Validate all input (zod) and env at boot (packages/config).
DB access always scoped by workspace_id; prefer Supabase RLS as defense-in-depth. Hybrid data access: Supabase client + RLS on web; Kysely (service role, transaction pooler, repository layer) on api/worker. SQL migrations remain the source of truth; reuse packages/db/src/database.types.ts. See "Data access strategy" under §3.
Provider SDKs only inside packages/adapters.
Every send carries an idempotency_key; check actions before dispatch.
Account restriction is a domain event, not a thrown error.
Unit-test the rate governor, scheduler, and sequence engine thoroughly (safety-critical).
Commands (fill in as scaffolded): pnpm dev, pnpm build, pnpm test, pnpm lint, pnpm db:migrate, pnpm db:gen-types.


Required env vars (indicative)

SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
REDIS_URL
ADAPTER (mock|unipile; default mock — selects the transport adapter; see §5/§8)
UNIPILE_API_KEY, UNIPILE_DSN
LLM_API_KEY
TTS_API_KEY
CREEM_API_KEY (or DODO_API_KEY)
SENTRY_DSN
APP_URL


13. Out of scope


Channels: NO WhatsApp, Instagram/Meta, SMS, or any channel other than LinkedIn + email. Do not add them.
Not now (Part B / separate spec): predictive throttling, account-safety-as-headline-product, advanced AI quality guardrails + A/B, inbox intent-triage + booking automation, deep email deliverability tooling, advanced attribution. Build parity first.
No AI-receptionist features. No go-to-market/marketing code.



14. Domain gotchas (read before building safety-critical code)


LinkedIn has no official API for outreach; this violates LinkedIn ToS and accounts WILL occasionally get restricted even within limits (~1 in 4 at scale). Design for it.
Acceptance rate matters more than raw volume for restriction risk — surface and respect it.
Voice notes are sent as native LinkedIn voice notes (normally mobile-only) — a transport capability (Unipile), not an AI feature.
Buying transport does NOT buy safety pacing — the rate governor/scheduler/warm-up are ours.
Condition-check nodes silently consume the profile-visit budget (they load the profile) — account for it in the rate governor.
Payment providers (MoR) may classify outreach automation as higher-risk — keep a backup processor configured; never block the app on a single provider.