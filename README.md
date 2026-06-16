# 10xConnect

B2B cold-outreach SaaS (LinkedIn-first; email later). A feature-parity build of Prosp.ai with
account safety as the core moat. This repository is a **pnpm + Turborepo monorepo**.

> Authoritative spec: [`CLAUDE.md`](./CLAUDE.md). Build plan: [`docs/BUILD_ROADMAP.md`](./docs/BUILD_ROADMAP.md).
> We build strictly in roadmap order, one step per prompt. This is **Step 1 (scaffold only)** — no business logic yet.

## Workspace layout

```
apps/
  web/         Next.js (App Router, TS) — frontend. Placeholder home page.
  api/         NestJS (TS) — REST API + webhooks. Exposes GET /health.
  worker/      Node + TS service — hosts BullMQ consumers later. Logs "worker up" and idles.
packages/
  core/        Domain logic & shared types (ChannelAdapter interface lives here later). Empty barrel.
  adapters/    ChannelAdapter implementations — the ONLY place provider SDKs are imported. Empty barrel.
  db/          Supabase schema, migrations, generated types. Empty barrel.
  config/      Shared config + zod env validation. Exports a validated `env` object.
```

**Architecture rule (from `CLAUDE.md` §4):** provider SDKs (Unipile, ESP, LLM, TTS) are imported
**only** inside `packages/adapters`. Everything else depends on interfaces in `packages/core`.

## Prerequisites

- Node `>=20` (see [`.nvmrc`](./.nvmrc) — pinned to 22)
- pnpm `10.x` (`corepack enable` will provide the pinned version)

## Getting started

```bash
pnpm install
pnpm dev
```

`pnpm dev` boots all three runnable apps concurrently via Turborepo:

| App    | URL / behavior                          |
| ------ | --------------------------------------- |
| web    | http://localhost:3000                   |
| api    | http://localhost:3001 (GET /health)     |
| worker | logs `worker up` and idles              |

Verify the API:

```bash
curl http://localhost:3001/health   # -> {"status":"ok"}
```

## Scripts (root)

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `pnpm dev`         | Run web + api + worker in dev mode            |
| `pnpm build`       | Build every workspace                         |
| `pnpm lint`        | ESLint across the monorepo                    |
| `pnpm typecheck`   | `tsc --noEmit` across the monorepo            |
| `pnpm test`        | Run tests (placeholder until tests are added) |
| `pnpm format`      | Prettier write                                |

## Environment

Environment variables are validated by [`packages/config`](./packages/config) using zod. Copy the
template and fill values as later steps require them (all are optional in Step 1):

```bash
cp packages/config/.env.example .env
```

## Tooling

- TypeScript `strict: true` everywhere (no implicit `any`); shared base in
  [`tsconfig.base.json`](./tsconfig.base.json).
- ESLint (flat config, TypeScript + import rules) in [`eslint.config.mjs`](./eslint.config.mjs).
- Prettier, EditorConfig, and Turborepo pipeline in [`turbo.json`](./turbo.json).
