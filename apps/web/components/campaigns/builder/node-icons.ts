// Per-type icons for sequence nodes, shared by the node card (canvas) and the
// insert modal (the +Add step card grid) so both render the same glyph.

import {
  Clock,
  CornerDownRight,
  Eye,
  GitBranch,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  Send,
  Tag,
  ThumbsUp,
  UserCheck,
  UserPlus,
} from "lucide-react";
import type { ComponentType } from "react";

import type { NodeKind } from "@/lib/campaigns/nodes";

export const NODE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  send_connection_request: UserPlus,
  send_message: MessageSquare,
  send_voice_note: Mic,
  comment_last_post: MessageCircle,
  reply_comment: CornerDownRight,
  like_last_post: ThumbsUp,
  visit_profile: Eye,
  inmail: Mail,
  send_message_to_open_profile: Send,
  follow_lead: UserCheck,
  add_tag: Tag,
  wait_x_days: Clock,
};

/** Icon for a node by type + kind. Conditions always use the branch glyph. */
export function iconForType(
  type: string,
  kind?: NodeKind,
): ComponentType<{ className?: string }> {
  if (kind === "condition") {
    return GitBranch;
  }
  return NODE_ICONS[type] ?? MessageSquare;
}
