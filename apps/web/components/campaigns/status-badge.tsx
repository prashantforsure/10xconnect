import { Badge, type BadgeProps } from "@/components/ui/badge";

export type CampaignStatus = "draft" | "pending" | "running" | "stopped" | "completed";

const VARIANT: Record<CampaignStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "muted",
  pending: "warning",
  running: "success",
  stopped: "destructive",
  completed: "default",
};
const LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  running: "Running",
  stopped: "Stopped",
  completed: "Completed",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant={VARIANT[status] ?? "muted"}>
      {status === "running" ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {LABELS[status] ?? status}
    </Badge>
  );
}
