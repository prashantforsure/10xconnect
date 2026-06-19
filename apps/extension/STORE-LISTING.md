# Chrome Web Store listing — 10xConnect

Everything you paste into the Chrome Web Store **Developer Dashboard** when publishing.
Replace `app.10xconnect.com` / emails with your real values before submitting.

## Store listing

- **Name:** 10xConnect — LinkedIn Connector
- **Summary (≤132 chars):** Securely connect your LinkedIn account to 10xConnect using your real, signed-in session — no password required.
- **Category:** Productivity
- **Language:** English
- **Detailed description:**

  > 10xConnect is a B2B outreach platform for LinkedIn and email. This extension is how
  > you connect your LinkedIn account to your 10xConnect workspace — securely and in one
  > click.
  >
  > Instead of typing your LinkedIn password into another app, the extension rides your
  > real, already–signed-in LinkedIn session. That keeps your account safer and prevents
  > the repeated logouts that password-based tools cause.
  >
  > How it works:
  > 1. Install the extension and sign in to LinkedIn as you normally would.
  > 2. In 10xConnect, open Settings → Accounts and click “Connect with extension.”
  > 3. The extension hands your session to 10xConnect over a secure connection. Done.
  >
  > The extension only reads your LinkedIn session when you start the connect flow, only
  > works on the 10xConnect app, and never collects your browsing activity. You can
  > disconnect anytime from Settings → Accounts, or just uninstall the extension.

- **Privacy policy URL:** https://app.10xconnect.com/extension-privacy

## Privacy practices tab

- **Single purpose:** Connect the user's own LinkedIn account to their 10xConnect
  workspace by reading their signed-in LinkedIn session when they explicitly start the
  connect flow.
- **Permission justifications:**
  - `cookies` — Read the LinkedIn `li_at` session cookie so the user can authorize
    10xConnect to act on their behalf without re-entering their password.
  - Host access `https://*.linkedin.com/*` — Required to read the `li_at` cookie for
    linkedin.com. No other cookies or sites are accessed.
  - Content script on the app origin only — So that only the 10xConnect web app (and no
    other site) can request a connection.
- **Data usage disclosures (check these):**
  - Collects **Authentication information** (the LinkedIn session) — used only to connect
    the account; transmitted over HTTPS to 10xConnect; encrypted at rest.
  - **Not** sold to third parties. **Not** used for purposes unrelated to the single
    purpose. **Not** used for creditworthiness/lending.
- **Certifications:** confirm compliance with the Developer Program Policies.

## Screenshots (1280×800 or 640×400) — capture these

1. Settings → Accounts with the “Connect with extension” button.
2. The connect modal (country + proxy + “Connect with extension”).
3. The “Add to Chrome / re-check” state when the extension isn't detected.
4. A connected LinkedIn account showing status + health.
5. (Optional) The extension popup showing “Signed in to LinkedIn — ready to connect.”

## Notes

- Bump `manifest.json` `version` on every upload.
- Build the upload zip with `pnpm --filter @10xconnect/extension package`
  (set `EXTENSION_APP_ORIGIN` to your production web origin first).
