import type { INodeType, INodeTypeDescription } from "n8n-workflow";

/**
 * 10xConnect action node (declarative routing — every operation maps straight
 * onto a public-API request; auth comes from the credential). Skeleton scope:
 * campaigns (list/get/pause/resume), leads (search/get), conversations
 * (list/get/reply). Grow resources here as the public API stabilizes.
 */
export class TenXConnect implements INodeType {
  description: INodeTypeDescription = {
    displayName: "10xConnect",
    name: "tenXConnect",
    icon: "fa:paper-plane",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "LinkedIn outreach automation — campaigns, leads, and the unified inbox",
    defaults: { name: "10xConnect" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: [{ name: "tenXConnectApi", required: true }],
    requestDefaults: {
      baseURL: "={{$credentials.baseUrl}}",
      headers: { Accept: "application/json" },
    },
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Campaign", value: "campaign" },
          { name: "Conversation", value: "conversation" },
          { name: "Lead", value: "lead" },
        ],
        default: "campaign",
      },

      // --- Campaign ----------------------------------------------------------
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["campaign"] } },
        options: [
          {
            name: "Get",
            value: "get",
            action: "Get a campaign",
            routing: { request: { method: "GET", url: '=/campaigns/{{$parameter["campaignId"]}}' } },
          },
          {
            name: "Get Analytics",
            value: "analytics",
            action: "Get campaign analytics",
            routing: {
              request: { method: "GET", url: '=/campaigns/{{$parameter["campaignId"]}}/analytics' },
            },
          },
          {
            name: "List",
            value: "list",
            action: "List campaigns",
            routing: { request: { method: "GET", url: "/campaigns" } },
          },
          {
            name: "Pause",
            value: "pause",
            action: "Pause a campaign",
            routing: {
              request: { method: "POST", url: '=/campaigns/{{$parameter["campaignId"]}}/pause' },
            },
          },
          {
            name: "Resume",
            value: "resume",
            action: "Resume a campaign",
            routing: {
              request: { method: "POST", url: '=/campaigns/{{$parameter["campaignId"]}}/resume' },
            },
          },
        ],
        default: "list",
      },
      {
        displayName: "Campaign ID",
        name: "campaignId",
        type: "string",
        required: true,
        default: "",
        displayOptions: {
          show: { resource: ["campaign"], operation: ["get", "analytics", "pause", "resume"] },
        },
      },

      // --- Lead ---------------------------------------------------------------
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["lead"] } },
        options: [
          {
            name: "Get Many",
            value: "list",
            action: "List leads",
            routing: { request: { method: "GET", url: "/leads" } },
          },
        ],
        default: "list",
      },

      // --- Conversation ---------------------------------------------------------
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["conversation"] } },
        options: [
          {
            name: "Get",
            value: "get",
            action: "Get a conversation",
            routing: {
              request: { method: "GET", url: '=/conversations/{{$parameter["conversationId"]}}' },
            },
          },
          {
            name: "List",
            value: "list",
            action: "List conversations",
            routing: { request: { method: "GET", url: "/conversations" } },
          },
          {
            name: "Reply",
            value: "reply",
            action: "Reply in a conversation",
            routing: {
              request: {
                method: "POST",
                url: '=/conversations/{{$parameter["conversationId"]}}/reply',
                body: { body: '={{$parameter["body"]}}' },
              },
            },
          },
        ],
        default: "list",
      },
      {
        displayName: "Conversation ID",
        name: "conversationId",
        type: "string",
        required: true,
        default: "",
        displayOptions: { show: { resource: ["conversation"], operation: ["get", "reply"] } },
      },
      {
        displayName: "Message",
        name: "body",
        type: "string",
        typeOptions: { rows: 3 },
        required: true,
        default: "",
        displayOptions: { show: { resource: ["conversation"], operation: ["reply"] } },
        description:
          "The reply text. Queued through 10xConnect's safety-governed dispatch (idempotent, respects account health) — not sent instantly.",
      },
    ],
  };
}
