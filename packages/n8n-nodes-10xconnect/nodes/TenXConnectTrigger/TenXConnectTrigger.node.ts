import type {
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";

const EVENTS = [
  { name: "New Reply", value: "reply" },
  { name: "Invite Accepted", value: "accepted_invite" },
  { name: "Message Sent", value: "message_sent" },
  { name: "Hot Lead", value: "hot_lead" },
  { name: "Campaign Completed", value: "campaign_completed" },
  { name: "Account Status Change", value: "status_change" },
];

/**
 * 10xConnect trigger: registers an outbound webhook via the key-authenticated
 * public API when the workflow is activated (POST /webhooks) and removes it on
 * deactivate (DELETE /webhooks/:id) — the reason webhook CRUD must be reachable
 * with an API key. Incoming deliveries carry the signed 10xConnect envelope;
 * the raw event JSON becomes the item.
 */
export class TenXConnectTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "10xConnect Trigger",
    name: "tenXConnectTrigger",
    icon: "fa:bolt",
    group: ["trigger"],
    version: 1,
    description: "Starts a workflow on 10xConnect events (replies, accepts, hot leads, …)",
    defaults: { name: "10xConnect Trigger" },
    inputs: [],
    outputs: ["main"],
    credentials: [{ name: "tenXConnectApi", required: true }],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "webhook",
      },
    ],
    properties: [
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        options: EVENTS,
        required: true,
        default: ["reply"],
        description: "Which 10xConnect events should start this workflow",
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl("default");
        const hooks = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          "tenXConnectApi",
          {
            method: "GET",
            url: "/webhooks",
            baseURL: (await this.getCredentials("tenXConnectApi")).baseUrl as string,
            json: true,
          },
        )) as Array<{ id: string; url: string }>;
        const existing = hooks.find((h) => h.url === webhookUrl);
        if (existing) {
          this.getWorkflowStaticData("node").webhookId = existing.id;
          return true;
        }
        return false;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl("default");
        const events = this.getNodeParameter("events") as string[];
        const created = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          "tenXConnectApi",
          {
            method: "POST",
            url: "/webhooks",
            baseURL: (await this.getCredentials("tenXConnectApi")).baseUrl as string,
            body: { name: "n8n trigger", url: webhookUrl, events },
            json: true,
          },
        )) as { id: string };
        this.getWorkflowStaticData("node").webhookId = created.id;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node");
        const webhookId = staticData.webhookId as string | undefined;
        if (!webhookId) {
          return true;
        }
        try {
          await this.helpers.httpRequestWithAuthentication.call(this, "tenXConnectApi", {
            method: "DELETE",
            url: `/webhooks/${webhookId}`,
            baseURL: (await this.getCredentials("tenXConnectApi")).baseUrl as string,
            json: true,
          });
        } catch {
          // Already gone (revoked in-app) — nothing to clean up.
        }
        delete staticData.webhookId;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData();
    return { workflowData: [this.helpers.returnJsonArray(body)] };
  }
}
