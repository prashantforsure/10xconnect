import { Module } from "@nestjs/common";

import { EnrichmentService } from "./enrichment.service";
import { importJobQueueProvider } from "./import-queue";
import { ImportService } from "./import.service";
import { leadSourceAdapterProvider } from "./lead-source.provider";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";

/**
 * Leads / CRM module (Phase 3, Steps 12–15). Owns lead CRUD + bulk actions, the
 * generic import engine (CSV + all LeadSourceAdapter sources), and async
 * enrichment. KYSELY_DB and CHANNEL_ADAPTER come from global modules.
 */
@Module({
  controllers: [LeadsController],
  providers: [
    LeadsService,
    ImportService,
    EnrichmentService,
    importJobQueueProvider,
    leadSourceAdapterProvider,
  ],
})
export class LeadsModule {}
