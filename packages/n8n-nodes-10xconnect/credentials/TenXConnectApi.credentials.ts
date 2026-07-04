import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * 10xConnect API credential: a workspace-scoped `10xc_` key sent as a bearer
 * token. Create keys in the app under Settings → API. The credential test hits
 * GET /webhooks (cheap, key-scoped, requires no extra permissions).
 */
export class TenXConnectApi implements ICredentialType {
  name = "tenXConnectApi";

  displayName = "10xConnect API";

  documentationUrl = "https://app.10xconnect.io/developers";

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "http://localhost:3001/api/v1",
      description: "The 10xConnect API base URL (no trailing slash)",
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description: "A 10xc_… workspace API key (Settings → API)",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/webhooks",
    },
  };
}
