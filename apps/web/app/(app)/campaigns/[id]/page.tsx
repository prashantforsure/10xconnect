import { CampaignDetail } from "@/components/campaigns/campaign-detail";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Toasts are provided app-wide by (app)/layout.tsx — no page-level provider,
  // otherwise this page would mount a second viewport.
  return <CampaignDetail campaignId={id} />;
}
