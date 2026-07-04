# Handoff: 10xConnect App Redesign

## Overview
This is a full visual redesign of the 10xConnect web app (`apps/web`) — an AI-SDR
LinkedIn outreach platform. The redesign replaces the current warm/amber theme with
a **cool, dark, Linear-style design system**: near-black surfaces, an indigo accent,
tight typography, and dense-but-calm information layouts.

The goal of this handoff is twofold:
1. **Recreate the redesigned screens** (documented below) in the real `apps/web`
   Next.js + React + Tailwind codebase, using its existing component structure.
2. **Bring every remaining screen/component into the same pattern** — several surfaces
   that exist in the codebase were not mocked here (auth, onboarding, marketing, some
   modals, base UI primitives). Restyle them using the design tokens + component
   recipes in this doc so the whole app is visually consistent.

## About the Design Files
The file in this bundle — **`10xConnect App.dc.html`** — is a **design reference
created in HTML**, not production code to copy. It is a single-file interactive
prototype (a "Design Component") showing the intended look and behavior of the whole
app: routing between screens, tab switching, modals, the collapsible sidebar, the
collapsible inbox panel, selection/bulk states, and the contacts drawer.

**Do not port the HTML directly.** The task is to reproduce the *look, spacing,
color, typography, and interaction* in the target codebase (`apps/web`) using its
existing stack:
- **Next.js App Router** (`app/(app)/...`)
- **React client components** (`components/...`)
- **Tailwind CSS** with tokens in `app/globals.css` + `tailwind.config.ts`
- **Radix-style local UI primitives** in `components/ui/*`
- **lucide-react** for icons

The cleanest path is to **update the Tailwind theme tokens and the `components/ui/*`
primitives once** to the new system, then each feature screen mostly falls into
place. See "Migration strategy" at the end.

## Fidelity
**High-fidelity (hifi).** All colors, typography, spacing, radii, and interaction
states below are final and exact. Recreate pixel-faithfully. Where a value isn't
listed, open `10xConnect App.dc.html` and read the inline style on the matching
element — every style is inline and literal.

---

## Design Tokens

### Color — surfaces (dark, cool-neutral)
| Token | Hex | Use |
|---|---|---|
| `bg/app` | `#08090A` | App background, behind everything |
| `bg/rail` | `#0A0B0D` | Left sidebar, inbox lead panel |
| `bg/surface` | `#101113` | Cards, list containers, thread bubbles (incoming) |
| `bg/inset` | `#0C0D0F` | Inputs, inset fields, table sub-rows, footers |
| `bg/elevated` | `#18191B` | Modals, toast |
| `bg/avatar` | `#2A2C33` | Avatar circles (also `#23252A` for the user footer) |

### Color — borders / hairlines
| Token | Value |
|---|---|
| `border/default` | `rgba(255,255,255,0.08)` |
| `border/subtle` | `rgba(255,255,255,0.06)` (row dividers) |
| `border/strong` | `rgba(255,255,255,0.10)` – `rgba(255,255,255,0.12)` (inputs, buttons) |

### Color — text (white with alpha)
| Token | Value | Use |
|---|---|---|
| `text/primary` | `rgba(255,255,255,0.92)` | Headings, key values |
| `text/secondary` | `rgba(255,255,255,0.60)` | Body, descriptions |
| `text/muted` | `rgba(255,255,255,0.45)` | Meta, timestamps |
| `text/faint` | `rgba(255,255,255,0.35–0.40)` | Placeholders, section labels |

### Color — accents (all used as solid + low-alpha tint)
| Token | Solid | Tints | Use |
|---|---|---|---|
| `accent/primary` (indigo) | `#5E6AD2` | `rgba(94,106,210, .07 / .10 / .12 / .14 / .18 / .22)` | Primary buttons, active nav, links, focus rings, AI |
| `accent/primary-text` | `#9BA3EB` | — | Indigo text on dark (links, AI labels) |
| `accent/purple` (branch) | `#B79CEF` / grad `#8B7CF0` | `rgba(168,124,240,0.14)` | Sequence branch/condition nodes, workspace logo gradient |
| `success` (green) | `#62BD87` | `rgba(76,183,130,0.13)` | Healthy, accepted, booked, sent |
| `warning` (amber) | `#D9A054` (bright `#E8B76A`) | `rgba(217,160,84,0.08 / .13 / .30)` | Hot leads, warnings, warming accounts |
| `danger` (red) | `#E5726F` | `rgba(229,90,86,0.12 / .25 / .40)` | Destructive, lost, danger zone |
| `linkedin` | `#3C8FE2` | — | LinkedIn glyph only |

> Note: **retire the current warm palette** (`#1A1811`, `#26221A`, `#38321F`,
> `#7A7363`, etc. seen in `contacts-client.tsx`, `connections-panel.tsx`). Replace
> those literals with the cool tokens above.

### Typography
- **Family:** `Inter, system-ui, sans-serif`, weights 400/500/600/700.
  `font-feature-settings: "cv11" 1, "calt" 1;` + `-webkit-font-smoothing: antialiased`.
- **Numbers:** `font-variant-numeric: tabular-nums` on all metrics/counts.
- **Scale (px / weight / line-height):**
  | Role | Size | Weight |
  |---|---|---|
  | Page title (h1) | 20 | 600, letter-spacing −0.01em |
  | Screen/section title | 13.5 | 600 |
  | Large metric | 20–26 | 600, letter-spacing −0.02em |
  | Body | 13 | 400/500, line-height 1.5–1.6 |
  | Secondary | 12–12.5 | 400/500 |
  | Small / meta | 11–11.5 | 400/500 |
  | Micro / timestamps | 10–10.5 | 400 |
  | Uppercase eyebrow label | 10.5–11 | 600, letter-spacing 0.05–0.08em, `text-transform:uppercase`, color `text/faint` |
- Base app `font-size: 14px; line-height: 1.5`.

### Radius
| Element | Radius |
|---|---|
| Buttons, inputs, small controls | 6–7px |
| Cards, containers, list wrappers | 8–9px |
| Modals | 12px |
| Badges / status chips | 5px |
| Pills / segmented / count badges | 9–16px |
| Avatars | 50% |
| Icon square (logo, feature icons) | 6–7px |

### Shadow
- Modal: `0 40px 100px -20px rgba(0,0,0,0.8)`
- Toast: `0 20px 50px -15px rgba(0,0,0,0.7)`
- Drawer: `-30px 0 80px -20px rgba(0,0,0,0.6)`
- Canvas floating stat bar: `backdrop-filter: blur(6px)` over `rgba(16,17,19,0.9)`

### Spacing & layout constants
- Page content padding: `28px 32px` (some tabs `24px 28px`).
- Card padding: `18px 20px` (compact `14px 18px` / `16px 18px`).
- Gaps: card grids `16px`; form stacks `12–16px`; inline chips `5–8px`.
- **Top header:** height `52px`, padding `0 24px`, bottom hairline.
- **Sidebar:** `224px` expanded, **`60px` collapsed** (icon-only rail).
- **Settings sub-nav:** `210px`.
- **Inbox:** thread list `316px`, conversation flex, **lead panel `280px` (collapsible)**.
- **Contacts lists sidebar:** `212px`. **Lead drawer:** `460px` (`max-width:94vw`).
- Scrollbars: 10px, thumb `rgba(255,255,255,0.10)` (`.nsb` class hides them).

### Icons
lucide (`lucide-react`), `stroke-width: 1.75`, sizes 13–16px (11–12px inside chips).

---

## Component Recipes
Reusable primitives. Update `components/ui/*` to match these, then reuse everywhere.

### Buttons
- **Primary:** bg `#5E6AD2`, text `#FFFFFF`, weight 600, size 12.5px, padding `6–8px 12–16px`, radius 7px, no border, `gap:6px` with a 13–14px leading icon.
- **Secondary / outline:** bg `transparent`, border `1px solid rgba(255,255,255,0.12)`, text `rgba(255,255,255,0.85)`, weight 500, else same metrics.
- **Ghost:** bg `transparent`, no border, text `rgba(255,255,255,0.45)`; hover raises to `0.75`.
- **Icon button:** `28–34px` square, radius 6–7px, secondary styling.
- **Segmented pill (in surface):** container `#101113` border default, radius 7px, `padding:2px`; active segment `background:rgba(255,255,255,0.09); color:0.92`, inactive `color:0.55`.

### Card
`background:#101113; border:1px solid rgba(255,255,255,0.08); border-radius:8–9px;`
padding `18px 20px`. Optional header row with bottom hairline for list cards.

### Input / select (display)
`background:#0C0D0F; border:1px solid rgba(255,255,255,0.10); border-radius:7px;`
padding `9px 12px`; font 13px; placeholder color `rgba(255,255,255,0.40)`. Focused/
primary field uses border `rgba(94,106,210,0.5)`. Select shows trailing
`chevron-down` at `rgba(255,255,255,0.40)`.

### Toggle switch
- Standard: track `32×18`, radius 9px; ON `#5E6AD2`, OFF `rgba(255,255,255,0.15)`;
  knob `14px` white, inset 2px, slides left/right (`transition: left .15s`).
- Small (inline, e.g. AI personalization): track `26×15`, knob `11px`, ON left `13px`.

### Badge / status chip
`display:inline-flex; padding:2px 8px; border-radius:5px; font-size:10.5–11px;
font-weight:600;` using an accent tint bg + solid text. Variants:
- success → `bg rgba(76,183,130,0.13)`, text `#62BD87`
- warning → `bg rgba(217,160,84,0.13)`, text `#D9A054`
- info/AI → `bg rgba(94,106,210,0.14)`, text `#9BA3EB`
- danger → `bg rgba(229,90,86,0.12)`, text `#E5726F`
- muted → `bg rgba(255,255,255,0.06)`, text `rgba(255,255,255,0.55)`

### Status dot
`5–6px` circle in the accent color, usually preceding a chip label.

### Tabs (underline)
Row of `span`s, padding `11px 12px`, inactive `color:0.55`, active `color:0.92`
with an absolutely-positioned 2px `#5E6AD2` underline bar (`left/right:12px; bottom:-1px`).

### Nav item (sidebar / list sidebar / settings)
`display:flex; gap:10px; padding:6–7px 10px; border-radius:6–7px; font 12.5–13px/500`.
Active: `background:rgba(255,255,255,0.07)` (or `rgba(94,106,210,0.14)` + `#9BA3EB`
in the contacts lists sidebar) with `color:0.92`. Inactive `color:0.60`.
Trailing count/badge right-aligned. **Collapsed rail:** `justify-content:center`,
labels/counts hidden, icon only, `title` attr as tooltip.

### Modal shell
Overlay `position:fixed; inset:0; background:rgba(0,0,0,0.55); backdrop-filter:blur(2px)`,
centered. Panel `background:#18191B; border:1px solid rgba(255,255,255,0.10);
border-radius:12px;` modal shadow. Header row (title + `x`) with bottom hairline;
body padding `18px 20px`; footer row on `#0C0D0F` with top hairline. Overlay click
closes; inner panel `stopPropagation`.

### Slide-over drawer (right)
Overlay as above but `justify-content:flex-end`. Panel `width:460px; max-width:94vw;
height:100%; background:#0C0D0F; border-left:1px solid rgba(255,255,255,0.10)`, drawer
shadow, own scroll. Header (avatar + name/role + `x`), then stacked sections with
uppercase eyebrow labels.

### Toast
`position:fixed; bottom:24px; left:50%; transform:translateX(-50%)`, `#18191B`,
border default, radius 9px, toast shadow, leading `check-circle-2` in `#62BD87`.
Auto-dismiss ~2.6s.

### Table / list row
CSS grid with fixed + `minmax(0,Nfr)` columns, `gap:12px`, row padding `11–12px 16–18px`,
bottom `border/subtle`. Header row: uppercase eyebrow labels. Row hover tint
`rgba(255,255,255,0.03–0.06)`; selected row `rgba(94,106,210,0.06)`. Custom 15px
checkbox: border `rgba(255,255,255,0.22)`, checked fills `#5E6AD2` with a white `check`.

---

## Screens / Views
All are in the single prototype; the app shell (sidebar + top header + `<main>`)
wraps every screen. Route names below map to `app/(app)/*`.

### App shell
- **Left sidebar** (`components/app-shell.tsx` region): logo + workspace switcher +
  nav groups (Main: Dashboard, Campaigns, Contacts, Inbox, Accounts, Agency;
  Workspace: Settings; Resources: Tutorials, Developers, Affiliate, API, Community) +
  user footer. **NEW: collapse toggle** (chevrons by the logo) shrinks it to a 60px
  icon rail; labels/section headers/counts hide, icons center, `title` tooltips.
- **Top header:** breadcrumb (`Group / Page`), right-aligned command-palette search
  button (`⌘K`) + primary "New campaign".
- **Command palette** (`⌘K`): centered modal, "Go to" + "Actions" groups.

### Dashboard (`/dashboard`)
Greeting + "AI SDR active" pill; 2-col grid (`1fr 380px`). Left: "Waiting on you"
card (AI draft rows with Approve/Edit/Discard; hot-lead row with Take over). Right
column: supporting cards. Approving a draft swaps the row to a green "handled" state
+ toast.

### Campaigns list (`/campaigns`)
Header + "New campaign". Grid/list of campaign cards with status chip (Running/Draft),
metrics, and progress.

### New campaign (`/campaigns/new`)
Centered `880px` column: template picker / blank start / "Build with AI" entry.

### Campaign detail (`/campaigns/[id]`)
Sticky sub-header: back, name, status chip, actions (Build with AI, Save as template,
Pause/Launch). Tabs: **Sequence · Leads · Context · Analytics · Settings**.
- **Sequence:** dotted-grid canvas with a vertical node flow (Visit → Connect →
  condition branch → AI Intro → Replied? branch → follow-up), delay pills, branch
  labels (Yes/No), and an "AI SDR takes over" chip. Clicking the Intro node opens a
  **440px right editor** (send-as, message w/ variable chips, AI-personalization
  toggle + live preview). Floating stats bar bottom-left.
- **Leads:** count summary + Import/Enrich; table (checkbox, name, headline, stage
  chip, step, enriched).
- **Context ("campaign brain"):** warning banner, Aim & offer, Knowledge base
  (empty state), Guardrails + Voice, Autonomy & budget (mode radios + 3 sliders).
- **Analytics:** 4 KPI cards, Funnel, Unit economics.
- **Settings:** Sender accounts; **Behavior** (Skip already-contacted, Exclude
  conn-req from reply rate, **Follow-up cap** stepper); **NEW Frequency / daily caps**
  (10 action types, each with a fill bar, ± stepper, "safe max N", auto-clamp info
  note, amber over-max warnings); **NEW Schedule (UTC)** (7 weekday rows: enable
  toggle + start/end + local-time hint); Danger zone.

### Build with AI (modal, 2-phase)
Intake form → wide review modal (generated 7-step sequence on the left, campaign
brain summary on the right, "Use this campaign").

### Inbox (`/inbox`)
Header: AI SDR on/off, stats, Review-queue button, pause/resume. 3 panes:
- **Thread list `316px`** (All / Needs you / Hot filters, thread rows w/ status chips).
- **Conversation** (header w/ Pause AI + stage + Profile + **NEW lead-panel toggle**;
  message bubbles — outgoing indigo tint + "✦ AI", incoming surface; composer with
  AI-draft approve card or hot-lead handoff card).
- **Lead panel `280px` (NEW: collapsible)** — Lead, Intent score, Campaign, Activity.
  Toggle (`panel-right-close/open`) hides it to give chat full width; same button reopens.

### Review queue (`/inbox` → review)
One-draft-at-a-time card: progress, "They said" quote, "AI will reply" draft +
grounding, Approve/Edit/Skip/Discard (keyboard hints). "Queue cleared" empty state.

### Contacts (`/contacts`) — fully rebuilt
Two-column: **lists sidebar `212px`** (All contacts, Connections, Do not contact,
divider, custom color-dot lists, New list) + main panel that switches:
- **Contacts:** title + Refresh/Export/Import; toolbar (search, Filter, **List/Board**
  toggle); **selection → bulk bar** (Tag, Add to list, Add to campaign, Do not
  contact, Delete); **List view** (checkbox, avatar, name+degree, role·company,
  headline, location, status chip, ⋮) and **Board view** (kanban grouped by tag).
  Row click opens the **lead detail drawer** (actions, location/degree/email, tags,
  About, Campaigns, Activity, Note).
- **Connections:** 1st-degree table with selectable rows (already-contacts disabled),
  selection bar (Add to contacts / Enroll in campaign), Load more.
- **Do not contact:** suppression table (identifier, reason, added, remove) + Add modal.

### Accounts (`/accounts`)
Sender cards with health ring gauges + limits; workspace-wide Safety limits card.

### Settings (`/settings`)
Sub-nav `210px` + panel: General, LinkedIn accounts, Members, Billing, Integrations,
API keys, Webhooks, White-label, Voice cloner.

### Agency / Tutorials / Developers / API / Affiliate / Community
Resource screens: card grids, code sample, referral, playbook list. (Currently lighter
mocks — expand to match real data.)

---

## Interactions & Behavior
- **Routing:** single active screen; sidebar/command-palette/back buttons switch it.
- **Sidebar collapse:** toggles width `224⇄60px` (`transition:width .16s`); persist
  in `localStorage` in the real app (prototype resets on reload).
- **Inbox lead panel collapse:** show/hide `280px` panel; persist likewise.
- **Tabs / sub-nav:** swap the visible section; active gets underline / tint.
- **Toggles & steppers:** update state live (frequency caps clamp at safe max and turn
  amber + surface a warning line when exceeded).
- **Selection:** clicking a row checkbox toggles it into a Set; the bulk bar appears
  when `size>0`; "×" clears. Board cards show a ring when selected.
- **Drawer / modals:** overlay click or `x` closes; inner click stops propagation.
- **Toasts:** transient confirmations (~2.6s) after actions (approve, launch, save…).
- **Transitions:** backgrounds/colors `.12s`; toggle knob/width `.15–.16s`. Keep
  motion subtle.

## State Management
Local component state mirrors the prototype's `state`:
`route, campaignTab, settingsTab, thread, inboxFilter, editorOpen, aiPers, modal,
aiSdr, reviewIdx, sidebarCollapsed, leadPanelOpen, contactsPanel, contactsView,
contactsList, selectedContacts (Set), contactDrawer, caps{}, followUpCap, schedule{}`.
In the real app, screen routing comes from the App Router; the rest are per-feature
client state (or server data). Collapse flags → `localStorage`. Frequency caps &
schedule already have API contracts — see `components/campaigns/settings-tab.tsx`
(`/campaigns/:id/settings/frequency`, `/schedule`).

## Assets
- **Icons:** lucide-react only. Names used include `layout-dashboard, megaphone, users,
  inbox, shield-check, building-2, settings, book-open, terminal, dollar-sign, code,
  messages-square, chevrons-left/right/up-down, search, plus, sparkles, check,
  check-circle-2, x, arrow-left, pause, play, bookmark-plus, eye, user-plus,
  git-branch, message-square, clock, refresh-cw, upload, download, list, list-filter,
  layout-grid, tags, ban, trash-2, more-vertical, external-link, linkedin, mic, shield,
  target, gift, sliders-horizontal, gauge, info, alert-triangle, panel-right-close,
  panel-right-open, key, webhook, palette, credit-card, blocks, calendar,
  message-circle, database, cloud, contact, rocket, rotate-ccw, upload-cloud, link-2`.
- **Avatars/logos:** placeholder monogram circles — wire to real user/lead avatars.
- **Fonts:** Inter via Google Fonts (or self-host to match).
- No raster/SVG illustration assets — all UI is CSS.

---

## Screens & components present in the codebase but NOT mocked here
Redesign these too, applying the tokens + recipes above. (Paths under `apps/web`.)

**Base UI primitives — do these FIRST (everything depends on them):**
`components/ui/`: `button, card, input, label, select, textarea, switch, slider,
badge, avatar, modal, slide-over, dropdown-menu, tabs, tooltip, table, progress,
separator, skeleton, command-palette, chart`. Rebuild each to the recipes above and
update `app/globals.css` + `tailwind.config.ts` tokens. Note the skeleton shimmer,
tooltip, and dropdown surfaces should use `#18191B`/`#101113` with default borders.

**Auth & onboarding (no mock — design in-pattern):**
`app/login`, `app/signup`, `app/reset-password`, `app/auth/auth-ui.tsx`,
`app/(app)/onboarding/*`. Use the modal/card recipes on `bg/app`; primary CTA indigo;
keep forms centered ~420px.

**Marketing site (no mock — design in-pattern or keep separate):**
`components/marketing/landing.tsx`, `marketing-shell.tsx`, `pricing-client.tsx`,
`app/pricing`, `app/page.tsx`, `app/developers`, `app/privacy`, `app/terms`,
`app/extension-privacy`. Confirm with product whether marketing adopts the same dark
system or stays on its own brand.

**Modals / pieces not individually mocked:**
`components/create-workspace-modal.tsx`, `components/workspace-switcher.tsx`,
`components/user-menu.tsx`, `components/simulation-banner.tsx`,
`components/campaigns/duplicate-campaign-modal.tsx`,
`components/campaigns/workflows-picker.tsx`, `components/campaigns/ab-compare.tsx`,
`components/campaigns/templates.tsx` (templates library),
`components/contacts/import-modal.tsx` (align to the modal recipe; an Import modal is
mocked on the campaign Leads tab you can mirror),
`components/campaigns/builder/*` and `composer/*` (match the Sequence canvas + node
editor styling), `components/dashboard/charts.tsx` and `ui/chart.tsx` (restyle chart
colors to the accent set: series in `#5E6AD2`, gridlines `rgba(255,255,255,0.08)`,
labels `text/muted`).

**Deeper coverage than the mock:** Agency, Tutorials, Developers, API, Affiliate,
Community were mocked lightly — flesh them out with real data using the card/list/table
recipes.

---

## Migration strategy (suggested order)
1. **Tokens:** update `tailwind.config.ts` colors + `app/globals.css` CSS variables to
   the surfaces/accents above; set Inter + `font-feature-settings`. Remove warm literals.
2. **Primitives:** restyle `components/ui/*` to the recipes. This alone reskins ~70%.
3. **App shell:** sidebar (with the new collapse rail + `localStorage`), top header,
   command palette.
4. **Feature screens** in this order: Dashboard → Inbox (+ collapsible lead panel +
   Review) → Campaign detail (Sequence/Leads/Context/Analytics/**Settings w/ frequency
   + schedule**) → **Contacts** (lists sidebar, list/board, bulk bar, drawer,
   connections, DNC) → Accounts → Settings → Resource pages.
5. **Not-mocked surfaces:** auth, onboarding, workspace/user menus, remaining modals,
   charts, marketing (per product).
6. QA each against `10xConnect App.dc.html` (open it side-by-side; every style is inline
   and literal, so it doubles as a spec).

## Files in this bundle
- `10xConnect App.dc.html` — the interactive design reference (all screens/states).
- `support.js` — runtime for the prototype (needed only to open the HTML locally; **not**
  part of what you implement). Open the HTML in a browser to explore states.
