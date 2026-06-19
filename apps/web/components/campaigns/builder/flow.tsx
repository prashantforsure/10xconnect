"use client";

import { BranchLabel, DelayPill, EndChip, InsertButton, Stat, StatChip } from "./connectors";
import { type BuilderContextValue, childIdAt, useBuilder } from "./context";
import { NodeCard } from "./node-card";

import { branchLabels, type Edge, type GraphNode } from "@/lib/campaigns/graph";

/** Action verb shown in a node's connector stat chip. */
const VERB: Record<string, string> = {
  send_connection_request: "sent",
  send_message: "messaged",
  send_message_to_open_profile: "messaged",
  inmail: "inmails sent",
  send_voice_note: "voice notes",
  visit_profile: "visited",
  like_last_post: "liked",
  comment_last_post: "commented",
  reply_comment: "replied",
  follow_lead: "followed",
  add_tag: "tagged",
};

/** Recursive entry point: render whatever is attached at `edge` and everything below. */
export function Segment({ edge }: { edge: Edge }) {
  const ctx = useBuilder();
  const childId = childIdAt(ctx, edge);
  return (
    <div className="flex flex-col items-center">
      <InsertButton edge={edge} />
      {childId == null ? <EndChip /> : <NodeBlock id={childId} />}
    </div>
  );
}

function NodeBlock({ id }: { id: string }) {
  const ctx = useBuilder();
  const node = ctx.nodeMap.get(id);
  if (!node) {
    return null;
  }
  if (node.type === "wait_x_days") {
    return (
      <div className="flex flex-col items-center">
        <DelayPill node={node} />
        <Segment edge={{ parentId: node.id, slot: "next" }} />
      </div>
    );
  }
  if (node.kind === "condition") {
    return <ConditionBlock node={node} />;
  }
  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} />
      <NodeStatChip node={node} ctx={ctx} />
      <Segment edge={{ parentId: node.id, slot: "next" }} />
    </div>
  );
}

function ConditionBlock({ node }: { node: GraphNode }) {
  const ctx = useBuilder();
  const labels = branchLabels(node.type);
  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} />
      <NodeStatChip node={node} ctx={ctx} />
      <div className="h-3 w-px bg-border" />
      <div className="relative flex items-start gap-10 pt-3">
        <div className="absolute left-1/4 right-1/4 top-0 border-t border-border" />
        <BranchColumn node={node} slot="false" label={labels.false} active={false} />
        <BranchColumn node={node} slot="true" label={labels.true} active />
      </div>
    </div>
  );
}

function BranchColumn({
  node,
  slot,
  label,
  active,
}: {
  node: GraphNode;
  slot: "true" | "false";
  label: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <BranchLabel text={label} active={active} />
      <Segment edge={{ parentId: node.id, slot }} />
    </div>
  );
}

function NodeStatChip({ node, ctx }: { node: GraphNode; ctx: BuilderContextValue }) {
  const s = ctx.stats?.nodes[node.id];
  const done = s?.done ?? 0;
  const leads = s?.leads ?? 0;
  if (node.kind === "condition") {
    return (
      <StatChip>
        {leads > 0 ? (
          <>
            <Stat>{leads}</Stat> evaluating
          </>
        ) : (
          "awaiting leads"
        )}
      </StatChip>
    );
  }
  const verb = VERB[node.type] ?? "done";
  return (
    <StatChip>
      <Stat>{done}</Stat> {verb}
      {leads > 0 ? <> · {leads} active</> : null}
    </StatChip>
  );
}
