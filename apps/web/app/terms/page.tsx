import { MarketingShell } from "@/components/marketing/marketing-shell";

export const metadata = { title: "Terms of Service — 10xConnect" };

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl space-y-4 px-6 py-16 text-sm leading-relaxed text-muted-foreground">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms of Service</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        <p>
          This is a placeholder terms of service for the 10xConnect MVP. Replace it with your
          counsel-reviewed terms before launch.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">Acceptable use</h2>
        <p>
          You are responsible for complying with the terms of the platforms you connect (including
          LinkedIn) and with applicable anti-spam laws (GDPR, CAN-SPAM). Automation of LinkedIn may
          violate its terms and carries account risk; we provide safety tooling but make no guarantee
          against restriction.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">Billing</h2>
        <p>
          Plans are billed per sending-account slot, monthly or annually. Campaigns, contacts,
          messages, and team members are unlimited.
        </p>
        <h2 className="pt-4 text-lg font-semibold text-foreground">Contact</h2>
        <p>Questions? Email support@10xconnect.example.</p>
      </article>
    </MarketingShell>
  );
}
