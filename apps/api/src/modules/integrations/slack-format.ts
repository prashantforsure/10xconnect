// Pure event → Slack message formatter (Block Kit). No DB, no DI — unit-
// testable; used by the delivery poller's Slack branch and the "send test"
// endpoint. Keep the output compact: one header line + a couple of context
// fields per event. Unknown event types fall back to a generic line so a new
// engine event can never break Slack delivery.

import type { EventEnvelope } from "./webhook-sender";

interface SlackMessage {
  text: string; // notification fallback line
  blocks: unknown[];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function leadLine(data: Record<string, unknown>): string {
  const lead = asObject(data.lead);
  const name = str(lead.name) ?? "A lead";
  const url = str(lead.linkedin_url);
  return url ? `<${url}|${name}>` : name;
}

function section(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function context(text: string): unknown {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

export function formatSlackMessage(envelope: EventEnvelope): SlackMessage {
  const data = asObject(envelope.data);
  switch (envelope.type) {
    case "reply": {
      const body = str(asObject(data.message).body);
      const text = `💬 New reply from ${leadLine(data)}`;
      return {
        text,
        blocks: [
          section(text),
          ...(body ? [section(`>${body.slice(0, 500)}`)] : []),
          context("Open the 10xConnect inbox to respond."),
        ],
      };
    }
    case "accepted_invite": {
      const text = `🤝 ${leadLine(data)} accepted your connection request`;
      return { text, blocks: [section(text)] };
    }
    case "hot_lead": {
      const summary = str(data.summary);
      const nextStep = str(data.next_step);
      const text = `🔥 Hot lead: ${leadLine(data)}`;
      return {
        text,
        blocks: [
          section(text),
          ...(summary ? [section(summary.slice(0, 1000))] : []),
          ...(nextStep ? [context(`Suggested next step: ${nextStep}`)] : []),
        ],
      };
    }
    case "status_change": {
      const account = asObject(data.account);
      const name = str(account.name) ?? "A LinkedIn account";
      const status = str(data.status) ?? "changed";
      const text = `⚠️ Account status: *${name}* is now \`${status}\``;
      return {
        text,
        blocks: [section(text), context("Its campaigns are paused automatically for safety.")],
      };
    }
    case "campaign_completed": {
      const campaign = asObject(data.campaign);
      const name = str(campaign.name) ?? "A campaign";
      const text = `🏁 Campaign completed: *${name}*`;
      return { text, blocks: [section(text)] };
    }
    case "message_sent": {
      const action = str(data.action_type) ?? "message";
      const text = `📤 ${action.replace(/_/g, " ")} sent to ${leadLine(data)}`;
      return { text, blocks: [section(text)] };
    }
    default: {
      const text = `🔔 10xConnect event: \`${envelope.type}\``;
      return { text, blocks: [section(text)] };
    }
  }
}
