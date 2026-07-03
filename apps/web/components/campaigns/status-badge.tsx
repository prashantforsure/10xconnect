import { Badge, type BadgeProps } from "@/components/ui/badge";

export type CampaignStatus = "draft" | "running" | "paused" | "stopped" | "completed";

const VARIANT: Record<CampaignStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "muted",
  running: "success",
  paused: "warning",
  stopped: "destructive",
  completed: "info",
};
const LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant={VARIANT[status] ?? "muted"} dot={status === "running"}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
