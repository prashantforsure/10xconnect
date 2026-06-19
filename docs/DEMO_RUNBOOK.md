# Demo & Run Runbook — 10xConnect MVP

How to run the app locally, rehearse the full loop on the safe **mock** adapter, and switch to **live Unipile** for a real pitch.

## 1. One-time setup

```bash
pnpm install
pnpm --filter @10xconnect/db db:migrate   # apply all migrations
pnpm --filter @10xconnect/db db:seed       # demo workspace + account + leads + a campaign
```

Seed login: `seed-user@10xconnect.test` / `Seed-User-Pw-1!` (or sign up fresh at `/signup`).

Required env (repo-root `.env`): `SUPABASE_*`, `DATABASE_URL`, `SECRETS_ENCRYPTION_KEY` (already set). Optional:
- `LLM_API_KEY` — **paste your Gemini key here to turn on AI personalization** (currently blank). `LLM_MODEL` defaults to `gemini-2.0-flash`.
- `ADAPTER` — `mock` (default, safe) or `unipile` (live).

## 2. Run

```bash
pnpm dev          # web (:3000) + api (:3001) + worker, all watch-mode
```
Or individually: `pnpm --filter @10xconnect/web dev`, `… /api dev`, `… /worker dev`.

The **worker** is the dispatch engine: it polls the `actions` table, enforces the rate governor + scheduler + warm-up, sends via the adapter, and advances each lead's sequence.

## 3. Rehearse the full loop on the MOCK adapter (no LinkedIn risk)

For a demo you can't wait for 15-minute spacing or weekday windows, so compress the cadence — **mock only, never a real account**. In `.env`:

```
ADAPTER=mock
DISPATCH_IGNORE_WORKING_HOURS=true
DISPATCH_MIN_SPACING_MS=2000
DISPATCH_JITTER_MS=1000
DISPATCH_TICK_MS=3000
```

Then:
1. **/settings/accounts** → connect a (mock) account, or use the seeded "Demo LinkedIn".
2. **/campaigns** → open "Demo: Founders Outreach" → **Builder** tab shows the sequence; **Leads** tab → Enroll the "Demo Founders" list.
3. **Run it!** — within a few seconds the worker dispatches connection requests (watch the worker logs / the campaign **Analytics** tab; the rate governor clamps at the daily cap).
4. **Simulate inbound events** (the same shape Unipile sends via webhook) — dev-only endpoint, disabled in production:
   ```bash
   # invite accepted → the sequence advances to the message step
   curl -X POST localhost:3001/api/v1/dev/simulate \
     -H "Authorization: Bearer <session-jwt>" -H "X-Workspace-Id: <ws>" \
     -H "Content-Type: application/json" -d '{"type":"invite_accepted","leadId":"<leadId>"}'

   # a reply → auto-stops the lead + lands in the Inbox
   curl ... -d '{"type":"reply","leadId":"<leadId>","body":"Interested!"}'

   # restriction → account auto-pauses + a notification is raised
   curl ... -d '{"type":"restriction"}'
   ```
   (Get `leadId` from the campaign Leads tab / `GET /campaigns/:id/leads`. Get the session JWT from the browser devtools, or drive the UI and use the dev endpoint via the network tab.)
5. **/inbox** → the reply appears; reply back (sends via the adapter), set a pipeline stage, use a saved response.
6. **/dashboard** + campaign **Analytics** → counts update (connections, accepted %, replies %).

## 4. Go live with Unipile (real LinkedIn)

> Real actions on a real account. Keep caps + working hours at their **safe defaults** (do NOT use the compressed demo cadence above).

1. `.env`: `ADAPTER=unipile`, `UNIPILE_API_KEY`, `UNIPILE_DSN` (already set), and restore safe dispatch defaults (remove the demo overrides, or set `DISPATCH_IGNORE_WORKING_HOURS=false`).
2. Expose the API's inbound webhook so Unipile can reach it:
   ```bash
   cloudflared tunnel --url http://localhost:3001   # or: ngrok http 3001
   ```
   Register the public URL `https://<tunnel>/api/v1/webhooks/inbound/unipile` as the messaging/relations/account-status webhook in the Unipile dashboard.
3. **/settings/accounts** → connect a real LinkedIn account (credentials + 2FA, or the extension flow). It starts in **warming** with reduced caps.
4. Build/enroll a small campaign and **Run it!** — verify one real action fires and a real reply (send yourself one from another account) lands in the Inbox and auto-stops the sequence.

## Safety notes (always on, both adapters)
- Daily caps clamp to safe maxima; new accounts ramp via warm-up; the scheduler respects working hours + ~15-min jitter.
- A detected restriction auto-pauses the account within one dispatch tick and raises a notification.
- Connection requests default to **no note**; a reply auto-stops the sequence; all dispatch + webhook handling is idempotent (no double-sends).
