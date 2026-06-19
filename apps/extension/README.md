# 10xConnect browser extension (MV3)

The **only** way to connect a LinkedIn account to 10xConnect (CLAUDE.md §6). It reads
the HttpOnly `li_at` session cookie from your already-signed-in LinkedIn tab and hands
it — together with your browser's user-agent — to the 10xConnect web app, which connects
the account through our transport provider.

## Why an extension (and why this fixes the logout loop)

- **No password, no third-party account.** It rides your real, authenticated LinkedIn
  session. You never enter LinkedIn credentials into 10xConnect, and you never create a
  Unipile or any other account — we run the automation infrastructure for you.
- **Stops the repeated logouts.** A captured real session + the **matching user-agent** +
  a **region-matched residential proxy** is what prevents LinkedIn's "impossible travel" /
  device-mismatch checkpoints that log accounts out. Server-side password logins from a
  datacenter (the old "credentials" method) are exactly what triggered those — they're gone.

## How it works

```
app page  --window.postMessage-->  content.js  --runtime.sendMessage-->  background.js
                                                                          (reads li_at cookie)
app page  <--window.postMessage--  content.js  <--sendResponse---------  background.js
```

- `background.js` — service worker; the only component with the `cookies` permission.
- `content.js` — injected **only** on the 10xConnect app origin; bridges page ↔ worker.
- `popup.js` / `popup.html` — shows whether you're signed in to LinkedIn.

The web side of this bridge lives in `apps/web/lib/extension/linkedin.ts`.

## Load it for development

1. Run the app stack: `pnpm dev` (web on `http://localhost:3000`, API on `:3001`).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select
   this folder (`apps/extension`).
3. Sign in to LinkedIn in the same Chrome profile.
4. In 10xConnect, go to **Settings → Accounts → Connect with extension**.

> With `ADAPTER=mock` (the default), the mock transport accepts any non-empty `li_at`, so the
> end-to-end flow works as long as you're signed in to LinkedIn (or have any `li_at` cookie).

## Icons

`icon.svg` is the source; the PNG sizes the store requires (16/32/48/128) are committed under
`icons/` and regenerated with `pnpm --filter @10xconnect/extension gen-icons` (uses `sharp`).

## Building the upload bundle

```bash
EXTENSION_APP_ORIGIN=https://app.yourdomain.com \
  pnpm --filter @10xconnect/extension package
```

This writes `dist/` (runtime files + a **production** manifest whose content script runs only
on `EXTENSION_APP_ORIGIN` — `http://localhost:3000` is dropped) and a versioned upload zip,
`10xconnect-extension-vX.Y.Z.zip`. The dev `manifest.json` keeps `localhost:3000` so unpacked
local testing still works; only the packaged build is origin-restricted.

> `EXTENSION_APP_ORIGIN` defaults to `https://app.10xconnect.com`. Set it to your real deployed
> web origin — this MUST be the domain the 10xConnect app is served from, or the bridge won't
> inject and "Connect with extension" will report "extension not installed."

## Publishing to the Chrome Web Store (public listing)

1. Create a developer account at <https://chrome.google.com/webstore/devconsole> (one-time **$5**).
2. Bump `manifest.json` `version`, then build the zip (above).
3. **New item → Upload** the zip.
4. Fill the listing + Privacy practices tabs using [STORE-LISTING.md](STORE-LISTING.md) (summary,
   description, screenshots, permission justifications, and the privacy-policy URL
   `https://<your-app-origin>/extension-privacy`, served by the web app at
   `apps/web/app/extension-privacy/page.tsx`).
5. Set **Visibility: Public**, then **Submit for review** (hours to a few days).
6. Once approved, copy the listing URL into `NEXT_PUBLIC_EXTENSION_STORE_URL` (web env) so the
   in-app **Add to Chrome** button points at it.

> Review note (CLAUDE.md §2 "responsible posture"): this extension reads an authentication
> cookie and enables automation, which gets extra scrutiny. The single-purpose framing, narrow
> permissions, and privacy policy here are written for that. An **Unlisted** listing lowers
> exposure if you want a quieter rollout.

## How users install it

Once published, users click **Add to Chrome** on the store listing (or the in-app button in
Settings → Accounts), sign in to LinkedIn, and click **Connect with extension**. No developer
mode, no file downloads.

## Permissions

- `cookies` + `host_permissions: https://*.linkedin.com/*` — to read the `li_at` cookie.
- `content_scripts.matches` — the app origin(s) allowed to request a capture.

No analytics, no remote code, no other hosts.
