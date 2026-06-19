import { AffiliateClient } from "@/components/affiliate-client";

export default function AffiliatePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Affiliate</h1>
        <p className="text-sm text-muted-foreground">Share 10xConnect and earn recurring commission.</p>
      </header>
      <AffiliateClient />
    </div>
  );
}
