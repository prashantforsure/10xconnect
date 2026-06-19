import { env } from "@10xconnect/config";
import { Controller, Get, Injectable, Module, Param, Post, UseGuards } from "@nestjs/common";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

const PROVIDERS = [
  { id: "hubspot", name: "HubSpot", category: "CRM" },
  { id: "salesforce", name: "Salesforce", category: "CRM" },
  { id: "pipedrive", name: "Pipedrive", category: "CRM" },
  { id: "calendly", name: "Calendly", category: "Calendar" },
  { id: "calcom", name: "Cal.com", category: "Calendar" },
  { id: "slack", name: "Slack", category: "Alerts" },
  { id: "zapier", name: "Zapier", category: "Automation" },
  { id: "make", name: "Make", category: "Automation" },
];

@Injectable()
export class IntegrationsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("integrations")
export class IntegrationsController {
  @Get()
  list() {
    // Scaffold: catalog with no live connections yet. Real OAuth round-trips land later.
    return PROVIDERS.map((p) => ({ ...p, connected: false }));
  }

  @Post(":provider/connect")
  connect(@Param("provider") provider: string) {
    return {
      status: "not_available" as const,
      message: `${provider} integration is on the roadmap — not wired in this MVP.`,
    };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("affiliate")
export class AffiliateController {
  @Get()
  dashboard(@WorkspaceId() workspaceId: string) {
    const code = workspaceId.slice(0, 8);
    return {
      referralCode: code,
      referralUrl: `${env.APP_URL}/signup?ref=${code}`,
      stats: { clicks: 0, signups: 0, earningsUsd: 0 },
      payoutRatePct: 30,
    };
  }
}

@Module({
  controllers: [IntegrationsController, AffiliateController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
