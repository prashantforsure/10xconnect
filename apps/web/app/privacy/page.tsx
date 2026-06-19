import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata = { title: "Privacy Policy — 10xConnect" };

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl space-y-4 px-6 py-16 text-sm leading-relaxed text-muted-foreground">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        <p>
          This is a placeholder privacy policy for the 10xConnect MVP. Replace it with your
          counsel-reviewed policy before launch.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">What we store</h2>
        <p>
          Account and workspace data, the leads you import, and the messages your campaigns send and
          receive. Connected-account credentials and session material are encrypted at rest and are
          never exposed to the browser.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">Your controls</h2>
        <p>
          You can export or delete your workspace data at any time. We honor opt-out and suppression
          (do-not-contact) lists across sending.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">Contact</h2>
        <p>Questions? Email privacy@10xconnect.example.</p>
      </article>
    </MarketingShell>
  );
}
