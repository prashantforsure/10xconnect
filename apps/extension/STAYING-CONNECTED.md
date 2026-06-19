# Keeping a LinkedIn account connected (no repeated logouts)

LinkedIn logs an automated account out when the session looks like it moved to a new
"device" or location. Avoiding that is about keeping three things **stable and consistent
with each other**: the **session** (li_at), the **IP region** (proxy), and the
**user-agent**. Below is everything we set, plus what the operator must do.

## What 10xConnect already does

- **Passes the matching user-agent** with the session on every connect/reconnect — Unipile's
  top recommendation against disconnects. (Extension captures it automatically; the manual
  li_at form pre-fills it with the current browser and requires it.)
- **Region-matched residential proxy** (`bundled`, matched to the account country) so the
  account's traffic comes from a stable IP in the right country — defeats "impossible
  travel" checkpoints. Verify the session with the provider **before** saving, so a dead
  cookie is never stored as "connected."
- **Reconnect-in-place**: refreshing the session keeps the same account row, country, and
  proxy region (no IP shuffle) and preserves campaigns + history.
- **Warm-up + rate governor**: new accounts ramp up gradually and never exceed safe daily
  action limits, and a detected restriction auto-pauses the account.

## Settings to get right when connecting

1. **Country** — set it to where the account actually signs in (the dropdown). This drives
   the proxy region; a wrong country = wrong-country IP = checkpoint.
2. **Proxy** — use **our proxy** (bundled, region-matched) unless you have a dedicated
   residential proxy in the account's region. If you bring your own, make it a **residential,
   sticky** IP in that country — not a datacenter IP and not rotating.
3. **li_at + user-agent (manual/testing path)** — copy **both from the same browser/profile**
   where you're signed in. The user-agent must match the browser the li_at came from.
4. **2FA** — keep two-factor enabled on the LinkedIn account.

## Operator precautions (what NOT to do)

- ❌ Don't sign out of LinkedIn in that browser, and never use **"Sign out of all other
  sessions"** — both invalidate the li_at immediately.
- ❌ Don't change the account password (invalidates sessions).
- ❌ Don't log the account in from lots of different networks/devices while it's running on
  the proxy — pick a lane and stay in it.
- ❌ Don't switch the account's country/proxy region between reconnects.
- ❌ Don't exceed the configured daily caps (the rate governor enforces this; don't fight it).

## If it still gets logged out

Reconnect from **Settings → Accounts → Reconnect** with a fresh li_at (or via the extension).
It refreshes the session in place and keeps your campaigns and history. If it disconnects
*repeatedly*, the usual culprit, in order: (1) user-agent not matching the li_at's browser,
(2) proxy region/country mismatch or a rotating/datacenter IP, (3) the account being actively
used elsewhere on a different network.

## A more robust option than pasting li_at

For production, **Unipile Hosted Auth** is the most reliable connect path: the user signs in
to LinkedIn through Unipile's managed flow, and Unipile establishes + maintains the session
in a consistent browser context bound to the assigned proxy. Because the session, fingerprint,
and IP all originate together and stay together, it's the least logout-prone option and needs
no cookie copying and no extension. It's a larger change (a new connect flow against Unipile's
hosted-auth API) and is the recommended next step beyond the extension.
