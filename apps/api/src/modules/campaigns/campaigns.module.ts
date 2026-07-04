import { Module } from "@nestjs/common";

import { CampaignRunService } from "./campaign-run.service";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

/**
 * Campaigns module (Phase 5, Steps 21–22): CRUD + General/Frequency/Schedule
 * settings. Caps are clamped to safe maxima (CLAUDE.md §6) on save; the schedule
 * is validated. The sequence graph, run/stop, leads, and analytics routes are
 * filled by later milestones. KYSELY_DB comes from the global database module.
 */
@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignRunService],
  exports: [CampaignsService, CampaignRunService],
})
export class CampaignsModule {}
