import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { ChannelAdapterModule } from "./adapter/channel-adapter.module";
import { SupabaseAuthGuard } from "./auth/supabase-auth.guard";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { DatabaseModule } from "./database/database.module";
import { EngineModule } from "./engine/engine.module";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";
import { AccountsModule } from "./modules/accounts.module";
import { AiModule } from "./modules/ai.module";
import { AnalyticsModule } from "./modules/analytics.module";
import { ApiKeysModule } from "./modules/api-keys.module";
import { BillingModule } from "./modules/billing.module";
import { BrainModule } from "./modules/brain.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { ConversationsModule } from "./modules/conversations.module";
import { DevModule } from "./modules/dev.module";
import { HostedAuthModule } from "./modules/hosted-auth.module";
import { IntegrationsModule } from "./modules/integrations.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { ListsModule } from "./modules/lists.module";
import { NotificationsModule } from "./modules/notifications.module";
import { PersonalizationModule } from "./modules/personalization.module";
import { WebhooksModule } from "./modules/webhooks.module";
import { WorkflowTemplatesModule } from "./modules/workflow-templates.module";
import { WorkflowsModule } from "./modules/workflows.module";
import { WorkspacesModule } from "./modules/workspaces.module";

@Module({
  imports: [
    // HTTP rate limiting (abuse guard). Per-IP: 300 requests/minute by default.
    // Provider webhooks are exempted with @SkipThrottle() so retries never drop.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    ChannelAdapterModule,
    EngineModule,
    WorkspacesModule,
    AccountsModule,
    HostedAuthModule,
    AiModule,
    LeadsModule,
    ListsModule,
    CampaignsModule,
    ConversationsModule,
    NotificationsModule,
    BrainModule,
    PersonalizationModule,
    WorkflowTemplatesModule,
    WorkflowsModule,
    AnalyticsModule,
    BillingModule,
    WebhooksModule,
    ApiKeysModule,
    IntegrationsModule,
    DevModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
