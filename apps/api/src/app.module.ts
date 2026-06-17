import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { ChannelAdapterModule } from "./adapter/channel-adapter.module";
import { SupabaseAuthGuard } from "./auth/supabase-auth.guard";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { MeController } from "./me/me.controller";
import { AccountsModule } from "./modules/accounts.module";
import { AnalyticsModule } from "./modules/analytics.module";
import { ApiKeysModule } from "./modules/api-keys.module";
import { BillingModule } from "./modules/billing.module";
import { CampaignsModule } from "./modules/campaigns.module";
import { ConversationsModule } from "./modules/conversations.module";
import { IntegrationsModule } from "./modules/integrations.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { ListsModule } from "./modules/lists.module";
import { WebhooksModule } from "./modules/webhooks.module";
import { WorkspacesModule } from "./modules/workspaces.module";

@Module({
  imports: [
    DatabaseModule,
    ChannelAdapterModule,
    WorkspacesModule,
    AccountsModule,
    LeadsModule,
    ListsModule,
    CampaignsModule,
    ConversationsModule,
    AnalyticsModule,
    BillingModule,
    WebhooksModule,
    ApiKeysModule,
    IntegrationsModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
