<div align="center">

# 🐙 10xConnect

### The account-safety-first platform for B2B cold outreach on LinkedIn & email

Import leads → enrich → run multi-step, AI-personalized sequences (LinkedIn actions + email + voice notes) → auto-stop on reply → manage every conversation in one unified inbox.

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-API-E0234E?logo=nestjs&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?logo=turborepo&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)

</div>

---

> [!IMPORTANT]
> **The #1 priority of this project is account safety, not the AI.** The rate governor, scheduler, warm-up state machine, and health monitor are what keep a user's LinkedIn account alive — the AI personalization is the commoditized part. Read [`CLAUDE.md`](./CLAUDE.md) (the authoritative product spec) before contributing.

## Table of contents

- [What is 10xConnect?](#what-is-10xconnect)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Monorepo layout](#monorepo-layout)
- [Prerequisites](#prerequisites)
- [Quick start (TL;DR)](#quick-start-tldr)
- [Full setup walkthrough](#full-setup-walkthrough)
  - [1. Clone & install](#1-clone--install)
  - [2. Create a Supabase project](#2-create-a-supabase-project)
  - [3. Configure environment variables](#3-configure-environment-variables)
  - [4. Apply database migrations](#4-apply-database-migrations)
  - [5. (Optional) seed demo data](#5-optional-seed-demo-data)
  - [6. Run the stack](#6-run-the-stack)
- [Mock mode vs. live (Unipile) mode](#mock-mode-vs-live-unipile-mode)
- [Dispatch pacing & safety knobs](#dispatch-pacing--safety-knobs)
- [Environment variable reference](#environment-variable-reference)
- [Common commands](#common-commands)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Responsible use & disclaimer](#responsible-use--disclaimer)
- [License](#license)

## What is 10xConnect?

10xConnect is a **feature-parity build of Prosp.ai** (with email as a co-equal channel), designed for sales teams, founders, and agencies who run personalized multi-step outreach at scale.

The core loop:

```
import / find leads → enrich → run a multi-step sequence
(LinkedIn actions + email + AI voice notes, all AI-personalized)
→ auto-stop the sequence on reply → unified inbox → book the call
```

What makes it different from "just another sequencer": **buying transport (Unipile) does not buy safety.** The per-account rate governor, working-hours scheduler, new-account warm-up ramp, and restriction detection are all owned by *this* codebase's orchestration layer. The system will **refuse to exceed researched-safe action limits even when asked** — it warns and clamps rather than silently bursting.

## Features

<table>
<tr><td width="50%" valign="top">

**📥 Lead sourcing & CRM**
- Import from 8+ sources (CSV, LinkedIn/Sales Navigator search, posts, groups, events, profile URLs, lead finder)
- Continuous "live import" — re-poll a source and pull only new leads
- Enrichment (headline, about, company, role, recent activity, connection degree)
- Contact lists, tags, custom columns, board/list views, dedupe

**🧩 Visual sequence builder**
- Branching canvas (React Flow) that forks at condition nodes
- 12 LinkedIn action nodes + email, plus condition/logic nodes
- Inline composer: variable chips, AI chips, attachments, per-node sender selection
- "Build with AI" campaign generator + "Refine with AI"

</td><td width="50%" valign="top">

**🛡️ Account safety (the moat)**
- Per-account daily caps, clamped to safe maxima (never exceeded)
- Randomized human pacing (~15 min between sends, jittered) inside working hours
- New-account warm-up ramp (4–6 weeks)
- Restriction/captcha auto-pause within one dispatch cycle + reroute to healthy accounts
- Multi-account sender rotation (sticky-per-lead, load-balanced)

**🤖 AI SDR & unified inbox**
- Grounded AI replies with an autonomy dial (approve / auto-easy / full-auto)
- Hot-lead detection → human handoff with a summary
- Humanized auto-reply delay (5–10 min) so replies never look like a bot
- One inbox across all accounts, pipeline stages, saved responses

</td></tr>
</table>

## Architecture

Three layers, with a **sacred adapter boundary**: the app and orchestration layers **never** call a transport provider SDK directly — everything goes through the `ChannelAdapter` / `EmailAdapter` interfaces, and provider SDKs are imported **only** inside `packages/adapters`.

```mermaid
flowchart TD
    subgraph APP["🖥️ Application layer"]
        WEB["apps/web · Next.js<br/>dashboard · builder · inbox · settings"]
        API["apps/api · NestJS<br/>REST API · webhooks · RBAC"]
    end

    subgraph BRAIN["🧠 Orchestration layer — OURS (the safety engine)"]
        WORKER["apps/worker · dispatch loop"]
        ENGINE["packages/engine<br/>sequence engine · rate governor<br/>scheduler · warm-up · AI brain"]
        CORE["packages/core<br/>ChannelAdapter interface · domain types · rate rules"]
    end

    subgraph TRANSPORT["🔌 Transport layer"]
        ADAPTERS["packages/adapters<br/>mock · unipile · email · LLM · voice<br/>(ONLY place provider SDKs are imported)"]
    end

    DB[("Supabase Postgres<br/>RLS + migrations")]

    WEB -->|"@supabase/supabase-js + RLS"| DB
    API --> ENGINE
    WORKER --> ENGINE
    ENGINE --> CORE
    ENGINE -->|"Kysely (service role,<br/>row locking)"| DB
    ENGINE --> ADAPTERS
    ADAPTERS -->|"Unipile / ESP / Gemini / TTS"| EXT["External providers"]
```

**Execution model** — the dispatch worker is the heart of the product. Each tick it: claims due actions (row-locked, idempotent) → checks the account is sendable → enforces the rate governor (per-account daily caps, aggregated across all campaigns, warm-up-adjusted) → sends via the adapter → records the result idempotently (no double-sends) → advances the lead's sequence. Inbound webhooks (reply, accepted invite, restriction) drive auto-stop and inbox updates.

## Tech stack

| Layer | Choice |
| --- | --- |
| **Frontend** | Next.js (App Router) · React · TypeScript · Tailwind · shadcn/ui · React Flow |
| **API** | NestJS (TypeScript) — REST + webhook handlers |
| **Workers** | Node + TypeScript dispatch service (BullMQ is a future swap; the DB is the queue today) |
| **Database / Auth / Realtime / Storage** | Supabase (Postgres, RLS, Auth, Realtime, Storage) |
| **Data access** | `@supabase/supabase-js` + RLS on web · **Kysely** (service role, transaction pooler, row locking) on api/worker |
| **Transport** | Unipile (LinkedIn), behind the `ChannelAdapter` interface |
| **AI** | Gemini (swappable `TextGenerationAdapter` / `EmbeddingAdapter`; `mock` provider works fully offline) |
| **Voice notes** | ElevenLabs (swappable; `mock` by default) |
| **Monorepo** | pnpm workspaces + Turborepo |

## Monorepo layout

```
apps/
  web/        Next.js frontend — dashboard, campaigns, builder, contacts, inbox, settings  (:3000)
  api/        NestJS REST API + webhook handlers                                            (:3001)
  worker/     Dispatch worker — rate governor, scheduler, sequence engine, AI brain
  extension/  MV3 browser extension — captures the real li_at to connect a LinkedIn account
packages/
  core/       Domain logic — ChannelAdapter interface, composer, rate rules, shared types
  engine/     Orchestration — sequence engine, dispatch, rate governor, conversation brain
  adapters/   ChannelAdapter/EmailAdapter/LLM/voice implementations — the ONLY place provider SDKs are imported
  db/         Supabase schema, SQL migrations (source of truth), generated types, seed scripts
  config/     Shared config + zod env validation (exports a validated `env` object)
  n8n-nodes-10xconnect/  n8n community-node skeleton for the public API
```

> **Golden rule:** provider SDKs (Unipile, ESP, LLM, TTS) are imported **only** inside `packages/adapters`. Everything else depends on interfaces in `packages/core`.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js ≥ 20** | 22 is pinned in [`.nvmrc`](./.nvmrc) and recommended. Use `nvm use` if you have nvm. |
| **pnpm 10.x** | Run `corepack enable` — it installs the exact version pinned in `package.json` (`packageManager`). |
| **A Supabase project** | Free tier is fine. You need the project URL, anon key, service-role key, JWT secret, and the pooled `DATABASE_URL`. |
| **Git** | To clone. |
| _(optional)_ **Gemini API key** | Turns on real AI personalization. Skip it and set `LLM_PROVIDER=mock` to run AI fully offline. |
| _(optional)_ **Unipile account** | Only needed for **real** LinkedIn sending. The default `mock` adapter needs nothing. |

## Quick start (TL;DR)

For the impatient — assumes you already have a Supabase project and a filled-in `.env`:

```bash
git clone https://github.com/prashantforsure/10xconnect.git
cd 10xconnect
corepack enable
pnpm install
cp .env.example .env                                   # then fill in the Supabase values (see below)
pnpm --filter @10xconnect/db db:migrate                # apply all 36 migrations
pnpm --filter @10xconnect/db db:seed                   # optional: demo workspace + leads + a campaign
pnpm dev                                               # web :3000 · api :3001 · worker
```

Open **http://localhost:3000**, sign up, and you're in. The default `ADAPTER=mock` means **nothing real is sent** — safe to explore end-to-end.

## Full setup walkthrough

### 1. Clone & install

```bash
git clone https://github.com/prashantforsure/10xconnect.git
cd 10xconnect
corepack enable          # provides the pinned pnpm version
pnpm install             # installs every workspace
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. From **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (secret!) → `SUPABASE_SERVICE_ROLE_KEY`
   - **JWT Secret** (Settings → API → JWT Secret) → `SUPABASE_JWT_SECRET`
3. From **Project Settings → Database → Connection string**, copy the **pooled** connection string → `DATABASE_URL`.
   - Use the **session pooler (port 5432)** for migrations, or the **transaction pooler (port 6543)** for app/worker runtime. The session pooler URL works for both to get started.

> **Google sign-in (optional):** configure the Client ID + Secret in the Supabase dashboard under **Authentication → Providers → Google**, and add `{NEXT_PUBLIC_SITE_URL}/auth/callback` to **Authentication → URL Configuration**. No app env var is needed.

### 3. Configure environment variables

Copy the template and fill it in. The real `.env` is git-ignored — **never commit secrets.**

```bash
cp .env.example .env
```

**Minimum to boot a working local app** (auth + data + safe mock sending):

```dotenv
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres.YOUR-PROJECT:PASSWORD@aws-...pooler.supabase.com:5432/postgres

# 32-byte key that encrypts connected-account credentials at rest. Generate with:
#   openssl rand -hex 32
SECRETS_ENCRYPTION_KEY=your-64-char-hex-key

# Safe defaults — nothing real is sent:
ADAPTER=mock
LLM_PROVIDER=mock        # AI works offline with no key
```

See the [environment variable reference](#environment-variable-reference) for the full list. Every variable is validated with zod at boot — a missing/invalid value fails fast with a readable error.

### 4. Apply database migrations

The SQL migrations in `packages/db/supabase/migrations` are the **source of truth** (they carry the schema, RLS policies, triggers, and functions):

```bash
pnpm --filter @10xconnect/db db:migrate
```

> Re-run this any time you pull changes that add migrations — an unapplied migration shows up as a `500` on a new table/column.

### 5. (Optional) seed demo data

```bash
pnpm --filter @10xconnect/db db:seed
```

Creates a demo workspace, a connected (mock) LinkedIn account, a lead list, and a ready-to-run campaign so you can exercise the full loop immediately. You can also just sign up fresh at `/signup`.

### 6. Run the stack

```bash
pnpm dev
```

This boots all three apps concurrently via Turborepo:

| App | URL / behavior |
| --- | --- |
| **web** | http://localhost:3000 |
| **api** | http://localhost:3001 (health: `curl http://localhost:3001/health` → `{"status":"ok"}`) |
| **worker** | logs `worker up`, then polls the `actions` table and dispatches on cadence |

Run a single app instead: `pnpm --filter @10xconnect/web dev` (or `.../api`, `.../worker`).

> **The web app fetches from the API on :3001** — for data-backed pages, run the full `pnpm dev`, not just the web app.

## Mock mode vs. live (Unipile) mode

| | **Mock (default)** | **Live (Unipile)** |
| --- | --- | --- |
| `ADAPTER` | `mock` | `unipile` (+ `UNIPILE_API_KEY`, `UNIPILE_DSN`) |
| Real LinkedIn actions? | ❌ never | ✅ yes — real sends on a real account |
| Needs a provider account? | No | Yes |
| Use for | Local dev, demos, tests, the full end-to-end loop | Production / a real pitch |

**To demo the full loop fast on mock** (compress the cadence — **mock only, never a real account**), set in `.env`:

```dotenv
ADAPTER=mock
DISPATCH_IGNORE_WORKING_HOURS=true
DISPATCH_MIN_SPACING_MS=2000
DISPATCH_JITTER_MS=1000
DISPATCH_TICK_MS=3000
```

Then connect a mock account in **/settings/accounts**, enroll leads into a campaign, hit **Run it!**, and watch the worker logs / campaign **Analytics** tab. The [Demo Runbook](./docs/DEMO_RUNBOOK.md) has a full script, including how to simulate inbound replies/restrictions.

**To go live**, see the runbook's [Go live with Unipile](./docs/DEMO_RUNBOOK.md#4-go-live-with-unipile-real-linkedin) section (connect a real account, expose the inbound webhook via a tunnel, keep caps + working hours at safe defaults).

## Dispatch pacing & safety knobs

The dispatch cadence is controlled by a single **`DISPATCH_MODE`** switch, with optional per-field overrides. Daily caps remain the hard safety ceiling in **both** modes — pacing only controls *cadence within the window*, never the daily total.

| Mode | Send spacing | AI auto-reply delay | Working hours | Use for |
| --- | --- | --- | --- | --- |
| `testing` _(default)_ | ~1s | instant | ignored | Mock demos & dev only |
| `production` | 4–8 min jittered | 5–10 min | respected | Real accounts |

**Recommended safe production pacing** (a ~15-minute gap between sends, jittered so it never bursts):

```dotenv
DISPATCH_MODE=production
DISPATCH_MIN_SPACING_MS=900000      # 15-min floor between sends per account
DISPATCH_JITTER_MS=300000           # + up to 5 min random → 15–20 min apart
AI_AUTO_REPLY_MIN_DELAY_MS=300000   # AI auto-replies wait 5 min…
AI_AUTO_REPLY_JITTER_MS=300000      # …+ up to 5 min → 5–10 min (never instant)
```

Human-approved inbox replies always send immediately; only **AI auto-sends** (the autonomy dial, no human in the loop) get the humanizing delay.

## Environment variable reference

Full, commented list lives in [`.env.example`](./.env.example). The essentials:

| Variable | Required? | Description |
| --- | --- | --- |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (server + browser) |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Anon public key (server + browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only service-role key (never exposed to the browser) |
| `SUPABASE_JWT_SECRET` | ✅ | API verifies user session JWTs with this |
| `DATABASE_URL` | ✅ | Pooled Postgres connection string |
| `SECRETS_ENCRYPTION_KEY` | ✅ | AES-256-GCM key (32 bytes hex/base64) — encrypts connected-account credentials at rest. `openssl rand -hex 32` |
| `ADAPTER` | — | `mock` (default) or `unipile` |
| `DISPATCH_ENABLED` | — | Master on/off for the dispatch loop (default `true`) |
| `DISPATCH_MODE` | — | `testing` (default) or `production` — see [pacing](#dispatch-pacing--safety-knobs) |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | — | `gemini` (default) or `mock`. Set `mock` to run AI offline |
| `EMBEDDING_PROVIDER` / `EMBEDDING_API_KEY` | — | Conversation-brain embeddings (falls back to the LLM key) |
| `UNIPILE_API_KEY` / `UNIPILE_DSN` | live only | Real LinkedIn transport |
| `WEBHOOK_SECRET` | — | Shared secret for inbound provider webhooks (fail-closed when set) |
| `APP_URL` / `API_PUBLIC_URL` | — | Public base URLs (needed for OAuth + Unipile Hosted Auth callbacks in prod) |

> In **development** almost everything is optional so the app boots without a full config. In **production** the app fails fast at startup if `SECRETS_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (and, for the API, `SUPABASE_JWT_SECRET`) are missing.

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run web + api + worker in watch mode |
| `pnpm build` | Build every workspace (dependency-ordered via Turborepo) |
| `pnpm lint` | ESLint across the monorepo |
| `pnpm typecheck` | `tsc --noEmit` across the monorepo |
| `pnpm test` | Run unit/integration tests |
| `pnpm format` | Prettier write |
| `pnpm --filter @10xconnect/db db:migrate` | Apply SQL migrations |
| `pnpm --filter @10xconnect/db db:seed` | Seed demo data |
| `pnpm --filter @10xconnect/db db:gen-types` | Regenerate `database.types.ts` from the live schema |
| `pnpm --filter @10xconnect/<pkg> build` | Build one package (needed after editing shared `db`/`core`/`engine` types so downstream apps see them) |

## Testing

```bash
pnpm test                                   # all workspaces
pnpm --filter @10xconnect/engine test       # engine unit + integration (rate governor, scheduler, brain)
pnpm --filter @10xconnect/api test:integration
pnpm --filter @10xconnect/web test:e2e      # Playwright end-to-end (needs a running stack)
```

The safety-critical pieces — **rate governor, scheduler, and sequence engine** — are covered by thorough unit + DB-backed integration tests. Integration tests need a reachable `DATABASE_URL`.

## Deployment

The three services deploy independently. A typical setup:

- **web** → Vercel (or any Next.js host).
- **api** & **worker** → Railway or Render (always-on).
- **database** → Supabase (managed).

Notes:

- **Build order matters.** `api` and `worker` depend on the shared packages (`config`, `core`, `db`, `adapters`, `engine`), whose `dist/` is git-ignored. Their `build` scripts already build those deps first — on Railway/Render, use a dependency-aware build (e.g. `pnpm --filter "@10xconnect/api..." build`) so the workspace deps compile before the app.
- **Set env vars in the host**, not in a committed file — mirror `.env.example`. In production, set `DISPATCH_MODE=production` and the [safe pacing values](#dispatch-pacing--safety-knobs).
- **Expose the inbound webhook** (`/api/v1/webhooks/inbound/unipile`) on a public URL and register it in the Unipile dashboard, plus set `API_PUBLIC_URL` so Hosted-Auth callbacks resolve.
- Run migrations against the production database as a deploy step: `pnpm --filter @10xconnect/db db:migrate`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API returns `500` on a new table/column | You have an unapplied migration → `pnpm --filter @10xconnect/db db:migrate` |
| Downstream app doesn't see a type you just added to `db`/`core`/`engine` | Rebuild that package → `pnpm --filter @10xconnect/<pkg> build` |
| Data pages error / empty | Run the **full** `pnpm dev` — the web app needs the API on `:3001` |
| `Invalid environment variables` at boot | zod caught a missing/malformed var — read the message; check `.env` against `.env.example` |
| Port `3000`/`3001` already in use | Kill stray `node` processes from a previous crashed run, then restart |
| AI features "off" locally | Set `LLM_PROVIDER=mock` (offline) or add a real `LLM_API_KEY`; restart the API after editing `.env` |

## Responsible use & disclaimer

LinkedIn automation **violates LinkedIn's Terms of Service**, and accounts can be restricted even within safe limits. This project is built to *minimize* that risk (rate limits, warm-up, working hours, restriction handling) but makes **no guarantee** of un-bannability, and it must never be marketed as such. It ships compliance helpers (GDPR/CAN-SPAM, opt-out, suppression / do-not-contact lists) — use them. You are responsible for how you use this software and for complying with all applicable laws and platform terms.

## License

This is a private, proprietary project (`"private": true`, no open-source license granted). All rights reserved by the repository owner. Do not redistribute without permission.

---

<div align="center">

Built with a safety-first philosophy. Spec: [`CLAUDE.md`](./CLAUDE.md) · Roadmap: [`docs/BUILD_ROADMAP.md`](./docs/BUILD_ROADMAP.md) · Demo: [`docs/DEMO_RUNBOOK.md`](./docs/DEMO_RUNBOOK.md)

</div>
