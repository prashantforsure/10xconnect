# 10xConnect — UI/UX Redesign Master Prompt

> Paste everything below the line into a fresh Claude Code (or Claude) session. It is self-contained: it assumes zero prior knowledge of the project and produces reviewable HTML mockups before any production code is written.

---

# Role & mission

You are a principal product designer with the taste of early Linear and Notion. Redesign the entire in‑app UI/UX of **10xConnect**, a B2B cold‑outreach SaaS, into one coherent design language I'll call **"Quiet Premium"**: Notion's calm, content‑first spaciousness fused with Linear's precision, density, and hairline structure. Light‑first, one accent color, immaculate type, zero decoration. Your deliverable is a set of **self‑contained HTML mockups** (inline CSS, no build step) that I will review and iterate on *before* any code is written. Do not write React or production code. Design first.

Your north star: a first‑time user understands every screen in **3 seconds without a tour**, and the whole app feels like a calm, trustworthy control room — never a growth‑hack tool.

# Product context (all you need to know)

10xConnect runs multi‑step, personalized outreach campaigns on **LinkedIn + email**. Users import leads → build a branching sequence of actions (connection request, message, voice note, comment, email, plus wait/condition steps) → the system sends on a safe cadence → replies auto‑stop the sequence and land in a unified inbox → users book calls. **The #1 product priority is account safety** (LinkedIn restricts accounts that move too fast), so the UI must always keep safety information — daily caps, account health, warm‑up state — calmly visible near the actions it governs. The tone is air‑traffic‑control, not confetti.

**Surfaces to design (complete list):**
- **App shell**: left sidebar nav, workspace switcher, top bar with breadcrumb + ⌘K search + one global "New campaign" CTA, mobile drawer.
- **Dashboard.**
- **Campaigns list** (status: draft / running / paused / stopped / completed).
- **Campaign detail** with tabs **Leads · Builder · Analytics · Settings**. The **Builder** is a visual branching sequence canvas; clicking a message node opens a docked **Composer** slide‑over.
- **Contacts** CRM (lists sidebar, filters, columns, table, bulk actions, 8‑source import modal).
- **Inbox** (3‑pane: thread list · conversation with AI‑drafted replies · lead panel; pipeline stages new / in_conversation / qualified / booked / lost).
- **Settings** (General, Accounts, Members, Billing, Webhooks, Integrations, API keys, Voice cloner, White label).
- **Auth** (login/signup) + **Onboarding** (2‑step). The marketing landing page is **out of scope**.

# Design principles

1. **Comprehension‑first.** One page title, one primary action, one dominant content region per screen. If a screen needs a tooltip to explain its purpose, restructure it.
2. **Progressive disclosure.** Show the 20% users need constantly; tuck the rest behind slide‑overs, popovers, and detail views. Never render a feature wall of equal‑weight cards.
3. **Calm, safety‑forward.** Quiet by default; unmistakably loud only when something needs attention (restricted account, budget breach, replies waiting). Safety info lives next to the action it governs.
4. **From Notion:** content‑first hierarchy (chrome recedes, data leads), generous line‑height and whitespace, plain‑language labels ("Connection requests · 12 of 15 today"), friendly instructive empty states.
5. **From Linear:** density where users work (tables, thread lists, the node canvas), 1px hairline structure instead of shadows, precise status language, visible keyboard affordances (⌘K hint, shortcut hints in menus).
6. **One of everything.** Exactly one badge system, one card, one table, one empty state, one form pattern, one focus ring — reused everywhere. Two components doing the same job with different styling is a defect.
7. **Every screen has a clear #1 read.** Never give two elements equal visual weight when one matters more. Never render the same number twice on one screen.

---

# Design system

Define all tokens as CSS custom properties in `00-design-system.html` and reference them in every file. Every value below is **normative — do not improvise**.

## Color (light theme)

**Neutral ramp (warm):**

| Token | Hex | Use |
|---|---|---|
| `--canvas` | `#FAFAF8` | App / page background |
| `--surface` | `#FFFFFF` | Cards, modals, inputs, table rows |
| `--wash` | `#F4F3F0` | Hovers, segmented‑control track, neutral badge bg |
| `--border` | `#EBEAE6` | Hairline: cards, dividers, table rows |
| `--border-strong` | `#D9D7D1` | Inputs, secondary buttons only |
| `--text-primary` | `#1C1B18` | Headings, body, values |
| `--text-secondary` | `#5C5A54` | Supporting copy, labels |
| `--text-tertiary` | `#8A877E` | Meta, placeholders, table headers |

**Coral accent — the ONLY brand hue:** `--coral-500 #F2683C` (chart series / large fills), `--coral-600 #DE5427` (buttons, focus, active indicators), `--coral-700 #B8431D` (links/coral text on white, AA), `--coral-50 #FDEEE7` (selected‑row wash). Coral appears **only** as: (1) the single primary button per view, (2) active sidebar‑nav indicator + focus ring, (3) one chart series. Nowhere else — no coral icons, headings, glows, or badge dots.

**Semantic status (text values ≥4.5:1 on white):**

| Intent | Text | Dot | Wash bg |
|---|---|---|---|
| Positive | `#15803D` | `#22C55E` | `#ECFDF3` |
| Caution | `#B45309` | `#F59E0B` | `#FEF6E7` |
| Danger | `#B91C1C` | `#EF4444` | `#FEF2F2` |
| Info | `#1D4ED8` | `#3B82F6` | `#EFF6FF` |
| AI / Logic‑violet | `#6D28D9` | `#8B5CF6` | `#F5F3FF` |
| Neutral | `#5C5A54` | `#A8A59C` | `#F4F3F0` |

**Chart palette (desaturated, coral leads):** `#F2683C`, `#8E9AC0`, `#7C9885`, `#C0A06A`, `#A98BA8`, `#8A877E`. Grid lines `#EBEAE6`. No gradients or area glows.

## Typography

Body/UI = **Hanken Grotesk**; also render one alternate sheet in **Inter** as an explicit A/B (same tokens, family swap only) so I can choose. Display = **Space Grotesk**, used ONLY for `display` and `metric`.

| Token | Size/Line | Weight | Family | Usage |
|---|---|---|---|---|
| `metric` | 32/36 | 600 | Space Grotesk | Hero KPI numbers only |
| `display` | 28/34 | 600 | Space Grotesk | Page titles only |
| `title` | 20/28 | 600 | Hanken | Modal / section titles |
| `heading` | 16/24 | 500 | Hanken | Card titles, form sections |
| `body` | 14/22 | 400 (buttons 500) | Hanken | Default UI, inputs |
| `small` | 13/20 | 400 | Hanken | Meta, table cells, help text |
| `label` | 12/16 | 500 | Hanken | Badges, table headers, KPI labels |

Letter‑spacing: `-0.01em` on `display`/`metric`; `0` elsewhere; `+0.04em` only on 12px UPPERCASE labels. `font-variant-numeric: tabular-nums` on all metrics, counters, and numeric table columns. **No arbitrary sizes** — these 7 only.

## Spacing & containers

8pt grid, allowed values only: **4, 8, 12, 16, 24, 32, 48, 64**. Card padding 24px (dense variant 16px). Page section gap 32px; form field gap 24px; icon‑to‑label gap 8px.

Container widths — one per page, never mixed: `default 1120px` (dashboard, campaigns, settings index), `narrow 720px` (settings forms, auth, onboarding), `wide 1320px` (contacts, analytics), `full` edge‑to‑edge (builder canvas, inbox). Page gutter 24px, top padding 32px.

## Radii, borders, elevation, motion

Radii — exactly three: `--r-sm 6px` (buttons, inputs, chips, nav items), `--r-md 10px` (cards, modals, popovers), `--r-full 999px` (badges, avatars, dots). Borders: 1px hairline `--border` everywhere; `--border-strong` on inputs; never 2px borders. **Cards get border only — zero shadow.** Shadows exist ONLY on floating layers: `--shadow-overlay: 0 4px 12px rgba(28,27,24,.08), 0 0 0 1px rgba(28,27,24,.04)` (dropdowns, popovers, tooltips); `--shadow-modal: 0 16px 48px rgba(28,27,24,.16)` (modals, slide‑overs). Scrim `rgba(28,27,24,.4)`.

Motion: `150ms cubic-bezier(.2,0,0,1)` for hover/active/opacity; 200ms for slide‑over/modal enter (translate ≤8px + fade). Animate only opacity, transform, background‑color. **Never** animate width/height/layout or run infinite loops — no ping, pulse, shimmer, or glow.

## Components

- **Buttons.** Heights sm 28 / md 32 (default) / lg 36; padding‑x 12/14/16; radius 6. Variants: `primary` (coral‑600 fill, white), `secondary` (white, 1px `--border-strong`), `ghost` (transparent, hover wash), `destructive` (`#B91C1C` fill). **Max one primary per view.**
- **StatusBadge — ONE component, all five domains.** 20px pill, wash bg + semantic text, 6px dot, 12/500 label, no border. Maps — *Campaign:* draft→Neutral, running→Positive, paused→Caution, stopped→Neutral, completed→Info. *Pipeline:* new→Neutral, in_conversation→Info, qualified→Violet, booked→Positive, lost→Neutral. *Enrichment:* pending→Neutral, enriching→Info, enriched→Positive, failed→Danger. *Account:* active→Positive, warming→Info, paused→Neutral, restricted→Danger, disconnected→Caution. *Role:* owner→Violet, admin→Info, member→Neutral. No other badge styling may exist.
- **Card** (the only surface pattern): white, 1px `--border`, radius 10, padding 24. Header = `heading` title + optional `small` tertiary description + right‑aligned ghost action. No nested cards, no shadows.
- **Data table**: row 44px (dense 36), header 36px `label` uppercase tertiary, horizontal hairlines only (no vertical rules, no zebra), hover row `--wash`, selected row `--coral-50` + 2px coral‑600 left inset, numeric columns right‑aligned tabular, sticky header.
- **Form field / section**: label 13/500 above input (6px gap), input 36px radius 6 border `--border-strong` white, help 12px tertiary below, error 12px `#B91C1C` + border swap. Sections = `heading` + `small` description, hairline divider + 32px between, single column in the 720px container.
- **Overlays**: dropdown/popover radius 10, `--shadow-overlay`, item height 32, hover wash. Modal 480 (large 640), radius 10, `--shadow-modal`, scrim. Slide‑over (composer, lead panel) 480px, full height, hairline left border + `--shadow-modal`, never stacked more than one deep.
- **Tabs**: 32px, 14/500, inactive tertiary, active text‑primary + 2px text‑primary underline (**not** coral). **Segmented control**: 32px `--wash` track, active segment white + hairline. **KPI card**: `label` uppercase + `metric` value + 13px semantic delta (▲/▼) + optional coral sparkline; no icons, no duplicate numbers. **Sidebar nav item**: 32px, radius 6, 14/500 secondary text, hover wash, active = wash bg + text‑primary + 2px coral‑600 left bar, icons 16px tertiary.
- **Focus ring — the ONE standard:** `outline: 2px solid #DE5427; outline-offset: 2px` on every interactive element.

---

# Screen‑by‑screen briefs

Build each from the token sheet only. Mock the listed states for each. Use realistic seeded data.

## 00 · Design system (`00-design-system.html`)
Render the full palette, the 7‑size type scale, spacing/radii/shadow specs, and living examples of: the one StatusBadge across **all five domains**, the one card, table, empty state, and form field, plus buttons/inputs/tabs/segmented‑control/dropdown in all states. This is the contract every other file inherits.

## 01 · Shell + Dashboard (`01-shell-dashboard.html`)
**Shell:** sidebar 240px — workspace switcher top (avatar + name + chevron), primary nav (Dashboard, Campaigns, Contacts, Inbox, Accounts — these five only), bottom‑pinned Settings + Resources flyout + user chip. Active item = 2px coral left bar + wash, no filled pill. Top bar 56px: breadcrumb left (`Campaigns / Q3 Founders Outreach`), ⌘K search as a quiet bordered pill center‑right, one coral "New campaign" button far right. Inbox nav item shows a plain unread count.

**Dashboard** answers three questions, strictly top‑to‑bottom (this is the whole IA — remove everything else):
1. **"Does anything need my attention?"** — an **attention strip**: 0–4 rows, each a semantic dot + one sentence + one action ("Sarah's account was restricted — campaigns paused" → Review; "4 replies need a response" → Open inbox; paused campaigns; remaining onboarding steps absorbed as ordinary rows). **All‑clear state collapses to one quiet green line:** "All systems healthy · 2 accounts active · 3 campaigns running."
2. **"Is my outreach working?"** — one row of 4 KPI blocks (Connections, Conversations, Reply rate, Acceptance rate) with small trend deltas, then one ~240px trend line chart beside a horizontal funnel (Contacted → Connected → Replied → Booked). Each number appears exactly once.
3. **"What's running?"** — compact campaigns table (name, StatusBadge, sent/accepted/replied, sparkline, row pause/resume).

Date‑range + campaign filter as quiet selects top‑right of the performance band. **Removed on purpose:** the donut "outreach mix", the tags card, the unit‑economics card (moves to Analytics/Billing), the right rail, and any duplicate hero card. No conditional card may shift the grid — fixed slots that collapse gracefully. **States:** all‑clear, needs‑attention (3 rows), new‑workspace (onboarding rows replace the performance band).

## 02 · Campaigns list (`02-campaigns-list.html`)
Job: "Which campaign do I open, is anything wrong?" Page header + "New campaign"; status segmented control (All/Running/Paused/Draft/Done) + search; one full‑width table (name, StatusBadge, leads, sent, accepted %, replied %, account avatar, updated, kebab). Numbers right‑aligned tabular; row hover faint wash only. **States:** populated (8+ mixed rows), empty (centered empty‑state, coral CTA).

## 03 · Campaign · Leads (`03-campaign-leads.html`)
Shared campaign header (back link, inline‑editable name, StatusBadge, "Run it!"/Stop primary, Share) + underline tabs. Toolbar (search, stage filter, Import contacts) + table with identity cell (avatar + name + headline), current‑node stage, enrichment StatusBadge, checkbox bulk bar sliding up on selection. **States:** populated, empty.

## 04 · Campaign · Builder + Composer (`04-campaign-builder.html`) — flagship, extra care
**Canvas:** near‑white with a 16px dotted grid at ~4% opacity; zoom/fit controls bottom‑left; a floating summary card top‑right (white, hairline, SENT / ACCEPTED / REPLIED as three small stats). "⚡ Campaign start" as a small white pill.

**Node card (280px):** 32px rounded icon tile (neutral tint) · 14px title · right‑aligned badge — violet‑tinted **Action** or amber‑tinted **Logic** (tinted text, not filled) · a per‑node lead counter chip bottom‑left ("142 here") · hover reveals reorder/delete icon buttons top‑right · an amber "Action required" dot+label when the body is empty. **Selection = 1.5px coral border + coral focus ring; nothing else on the canvas is coral.**

**Flow:** hairline connectors with a centered "+" insert button (20px, 40% opacity at rest, full on hover) opening Add action / Add condition / Insert template. **Condition nodes fork into two labeled branch columns**, each edge captioned ("Accepted" / "Not accepted"). `wait_x_days` renders as a "🕐 3 days" connector pill, not a card. Stat chips sit on connectors ("142 · 89% enriched", "56 sent") in 12px muted text with quiet placeholders pre‑run. Branches may end in an "× End of sequence" ghost chip.

**Composer (docked slide‑over, 480px):** header (node icon + type, "Change action type", close) · sender select · **chip‑based body editor** — free text interleaved with neutral variable chips (`First name` + fallback) and violet AI chips (sparkle) · toolbar: AI Prompt (opens Community/Saved/My Prompts library), Contact variables, Add media, Framework snippets · **guardrails lint** as a collapsed advisory strip (amber, **never blocking**: "Contains a hard CTA", ">50 words") · above‑the‑fold preview + "Preview across leads" cycling 3 seeded leads · send‑condition select · voice nodes get a recorder card with a ≤30s meter. **States to mock:** empty canvas (Build with AI / Start from scratch), populated linear, populated with a condition fork, one node selected with composer open, composer with lint warnings.

## 05 · Campaign · Analytics (`05-campaign-analytics.html`)
Metric band (requests, conversations, accepted %, replies %, InMails) + one chart + a "Past actions" audit table (time, account, action, lead, result) + a quiet "runs every 4–8 minutes to stay human" info line. **States:** populated, pre‑run empty.

## 06 · Campaign · Settings (`06-campaign-settings.html`)
Global form pattern. Sections: General, **Frequency** (per‑action caps as steppers with "safe max" helper text + clamp warning — safety made visible), **Schedule** (7‑day grid, per‑day toggle + time range), Danger zone.

## 07 · Contacts (`07-contacts.html`)
Inner lists sidebar 220px ("All contacts", MY LIST group, "Create list") · toolbar (search, Filters, Columns, list/board toggle, Import) · the one table (checkbox, identity cell, company, title, enrichment StatusBadge, tags max 2 + "+3", lists, added) · column‑visibility popover · bulk‑action bar on selection. **States:** populated, empty list, **import modal open** (8 source tiles in a 4×2 grid, one line each; CSV tile shows a column‑mapping preview).

## 08 · Inbox (`08-inbox.html`) — 3‑pane
**Thread list 320px:** filter tabs (All / Reply required / Important / Mine); rows = avatar, name, one‑line snippet, timestamp, **max ONE badge per row**, unread = 6px coral dot + semibold name. No badge pile‑ups. **Conversation center (flex):** thread header (lead name + channel icon only); inbound bubbles white/hairline, **outbound bubbles neutral‑gray fill, NOT coral**; an AI‑drafted reply is a distinct approval card (white, violet "AI draft" tag, body, Approve / Edit / Discard); escalation = a slim amber banner above the composer; composer pinned bottom with saved‑responses + AI‑assist; a thin AI‑SDR control bar (autonomy select, pause toggle) collapsed above the composer. **Lead panel 300px:** identity block → pipeline stage as a 5‑step vertical stepper → enrichment facts → tags → campaign membership. **States:** populated with one AI draft pending, empty inbox, escalated thread.

## 09 · Settings · Accounts (`09-settings-accounts.html`)
Settings pattern: 200px sub‑nav + 720px content column. Account cards (avatar, name, country, connection‑method label, health score as a small numeric ring/bar — not a gauge), StatusBadge (active/warming/paused/restricted/disconnected), row actions (Reconnect, Pause, Disconnect). Connect chooser = three equal option cards (Infinite login "Recommended", Hosted auth, Extension). Caps/schedule reachable per account. **States:** one healthy + one restricted account; no accounts connected.

## 10 · Settings · General (`10-settings-general.html`)
The settings pattern exemplar: sub‑nav + sections (Profile, Workspace, Inbox type, Auto‑withdraw, Danger zone) as field rows (label left ~200px, control right), sticky Save only when dirty. Members / Billing / Webhooks / API keys / Integrations reuse this exact pattern (Billing adds a slot stepper + plan card).

## 11 · Auth (`11-auth.html`)
Split‑screen: left 480px white panel (logo, form fields, coral submit, Google button), right warm‑neutral panel with one restrained product line + a static UI vignette (no gradients/glows). **States:** login, signup.

## 12 · Onboarding (`12-onboarding.html`)
Centered 640px card, 2‑step checklist (Connect account → Create campaign) with check circles, current step expanded, quiet "Book a call" + "Skip" links. **States:** step 1 active, step 1 complete.

---

# Anti‑patterns — never do these

- Never hardcode a hex outside the token block; never use an off‑scale font size, radius, spacing, or letter‑spacing value.
- Never create a second badge, card, table, empty‑state, or form pattern — one of each, reused.
- Never apply glow shadows, gradients, or any shadow on a non‑overlay surface (logo, CTAs, badge dots included).
- Never use coral beyond its three sanctioned roles; never use semantic colors decoratively.
- Never give two elements on one screen equal weight when one matters more; never render the same number in two places on one screen.
- Never pile more than one badge on an inbox thread row; never fill outbound message bubbles with the accent.
- Never mix container widths within a page family; never animate longer than 200ms or infinitely; never use dark surfaces this round.
- Never use lorem ipsum, "John Doe", or round fake numbers.

# Deliverables & process

1. **Self‑contained HTML** — one `.html` per screen, all CSS inline in a `<style>` block, no build step, no external assets except Google Fonts `<link>`s. Primary artboard **1440px desktop**; add a one‑line comment per file noting responsive intent.
2. **Files:** `00-design-system.html`, `01-shell-dashboard.html`, `02-campaigns-list.html`, `03-campaign-leads.html`, `04-campaign-builder.html`, `05-campaign-analytics.html`, `06-campaign-settings.html`, `07-contacts.html`, `08-inbox.html`, `09-settings-accounts.html`, `10-settings-general.html`, `11-auth.html`, `12-onboarding.html`. Every file opens with the identical `:root` token block copied from `00`.
3. **Seeded data:** realistic names, companies, headlines, plausible numbers throughout (e.g. "Priya Sharma — Head of RevOps, Clearline · 34% acceptance"). Never lorem ipsum, never round fakes.
4. **Iteration loop (mandatory):** present `00-design-system.html` **first and stop for my approval.** Then deliver in batches, pausing after each for feedback and revising before the next — **Batch A:** 01–02 · **Batch B:** 03–06 · **Batch C:** 07–08 · **Batch D:** 09–12. Never regenerate an approved file unless I ask.

# Acceptance checklist (every mockup must pass)

- [ ] Every color references a token; zero hex outside `:root`; coral only on primary action, active nav, selection/focus, and one chart series.
- [ ] Every text size is one of the 7 named sizes; all spacing on the 8pt grid; only the 3 radii; shadows only on overlays.
- [ ] Exactly ONE StatusBadge styles all five domains; one card, table, empty‑state, form pattern reused everywhere.
- [ ] No glows, gradients, pings, or pulses; all motion ≤200ms.
- [ ] Dashboard reads top‑to‑bottom: needs attention? → is it working? → what's running? — no metric rendered twice.
- [ ] Builder: coral only on the selected node; branches clearly labeled; every connector has an insert affordance; stat chips legible but subordinate.
- [ ] Inbox thread rows carry at most one badge; outbound bubbles are neutral, not accent‑filled.
- [ ] Content max‑width consistent within each page family; one documented focus‑ring on every interactive element.
- [ ] **3‑second test:** a stranger shown any screen can name its purpose unaided.
- [ ] **Tone test:** nothing reads "growth‑hack tool" — safety info (caps, health, clamps) is calmly visible; advisory warnings are amber and non‑blocking.
