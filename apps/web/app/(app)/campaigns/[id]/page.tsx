import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { ToastProvider } from "@/components/ui/toast";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ToastProvider>
      <CampaignDetail campaignId={id} />
    </ToastProvider>
  );
}
