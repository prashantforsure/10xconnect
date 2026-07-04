// MCP server (integrations Phase D): a remote Model Context Protocol endpoint
// at POST /api/v1/mcp — Streamable HTTP transport, STATELESS (one McpServer +
// transport per request; no sessions, no SSE resumption), authenticated by a
// `10xc_` API key in the Authorization header. Lets Claude / Cursor / any MCP
// client manage campaigns, leads, and the inbox for the key's workspace.
//
// Client setup:
//   claude mcp add --transport http 10xconnect https://<api>/api/v1/mcp \
//     --header "Authorization: Bearer 10xc_..."

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  All,
  Controller,
  Logger,
  Module,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { API_KEY_TOKEN_PREFIX, ApiKeyAuthService } from "../../auth/api-key-auth.service";
import { Public } from "../../common/decorators/public.decorator";
import { AccountsModule } from "../accounts.module";
import { AnalyticsModule } from "../analytics.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { ConversationsModule } from "../conversations.module";
import { WebhooksModule } from "../webhooks.module";

import { McpToolsService } from "./mcp-tools.service";

function rpcError(res: Response, httpStatus: number, code: number, message: string): void {
  res.status(httpStatus).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

// The MCP endpoint authenticates every request itself (API key + per-key rate
// limit), so the global guard is bypassed with @Public and the per-IP throttle
// is skipped (agent sessions burst many small JSON-RPC calls).
@Public()
@SkipThrottle()
@Controller("mcp")
export class McpController {
  private readonly logger = new Logger("Mcp");

  constructor(
    private readonly apiKeys: ApiKeyAuthService,
    private readonly tools: McpToolsService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const header = req.headers.authorization;
    const [scheme, token] = header?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token || !token.startsWith(API_KEY_TOKEN_PREFIX)) {
      rpcError(res, 401, -32001, "Authenticate with an API key: Authorization: Bearer 10xc_…");
      return;
    }

    let principal;
    try {
      // authenticate (not authorize): MCP is always POST — read_only keys are
      // gated per-tool at registration instead of per-HTTP-method.
      principal = await this.apiKeys.authenticate(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid API key";
      rpcError(res, 401, -32001, message);
      return;
    }

    // Stateless per-request server: no session ids, plain JSON responses.
    const server = this.tools.buildServer(principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${String(error)}`);
      if (!res.headersSent) {
        rpcError(res, 500, -32603, "Internal error");
      }
    }
  }

  /** GET/DELETE (SSE streams / session teardown) are not supported: stateless. */
  @All()
  methodNotAllowed(@Res() res: Response): void {
    rpcError(res, 405, -32000, "Method not allowed — POST JSON-RPC to this endpoint.");
  }
}

@Module({
  imports: [AccountsModule, AnalyticsModule, CampaignsModule, ConversationsModule, WebhooksModule],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
