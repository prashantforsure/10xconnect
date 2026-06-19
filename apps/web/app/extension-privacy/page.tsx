import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browser Extension Privacy Policy — 10xConnect",
  description:
    "What the 10xConnect browser extension accesses, why, and how that data is handled.",
};

const UPDATED = "June 18, 2026";

export default function ExtensionPrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">
        10xConnect Browser Extension — Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">Single purpose</h2>
          <p>
            The 10xConnect browser extension exists for one purpose: to connect your own LinkedIn
            account to your 10xConnect workspace. When you click “Connect with extension” in
            10xConnect, the extension reads your existing, signed-in LinkedIn session so you can
            authorize 10xConnect to act on your behalf — without typing your LinkedIn password into
            our app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">What it accesses</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Your LinkedIn session cookie (<code>li_at</code>)</strong> — read only when you
              explicitly start the connect/reconnect flow from the 10xConnect web app.
            </li>
            <li>
              <strong>Your browser’s user-agent string</strong> — sent alongside the session so
              LinkedIn recognizes the same device and is less likely to sign the account out.
            </li>
          </ul>
          <p>
            The extension reads cookies only for <code>linkedin.com</code>, and only the{" "}
            <code>li_at</code> cookie. It does not read cookies for any other site.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">
            What it does NOT collect
          </h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>No browsing history, page contents, or activity on any website.</li>
            <li>No keystrokes, form inputs, passwords, or analytics/tracking.</li>
            <li>No data from sites other than the 10xConnect app origin and linkedin.com.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">
            How the data is used and stored
          </h2>
          <p>
            The captured session is sent directly to 10xConnect over HTTPS and is used solely to
            connect your LinkedIn account to your workspace. It is encrypted at rest and used only to
            run the outreach you configure in 10xConnect. It is never sold or shared with third
            parties beyond the transport provider that operates the LinkedIn connection on your
            behalf. You can disconnect the account at any time from{" "}
            <strong>Settings → Accounts</strong>, and uninstalling the extension immediately revokes
            its access.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">Permissions</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <code>cookies</code> + access to <code>https://*.linkedin.com/*</code> — to read the{" "}
              <code>li_at</code> session cookie when you connect.
            </li>
            <li>
              The content script runs only on the 10xConnect app origin, so only 10xConnect can ask
              the extension to connect an account.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-foreground">Contact</h2>
          <p>
            Questions about this policy? Email{" "}
            <a className="underline" href="mailto:privacy@10xconnect.com">
              privacy@10xconnect.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
