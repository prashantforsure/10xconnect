import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingClient } from "@/components/marketing/pricing-client";

export const metadata = { title: "Pricing — 10xConnect" };

export default function PricingPage() {
  return (
    <MarketingShell>
      <PricingClient />
    </MarketingShell>
  );
}
