import type { DB } from "@10xconnect/db";
import {
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { KYSELY_DB } from "../database/database.module";

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
}

@Injectable()
export class CampaignsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /**
   * Minimal campaign list — id/name/status only. Added in Phase 3 to back the
   * contacts "enroll in campaign" picker; full campaign CRUD is Phase 5.
   */
  async list(workspaceId: string): Promise<CampaignSummary[]> {
    return this.db
      .selectFrom("campaigns")
      .select(["id", "name", "status"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string): Promise<CampaignSummary[]> {
    return this.campaigns.list(workspaceId);
  }

  @Post()
  create(): never {
    throw new NotImplementedException();
  }

  @Get(":id")
  detail(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Patch(":id")
  update(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Delete(":id")
  remove(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/sequence")
  getSequence(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Put(":id/sequence")
  saveSequence(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/start")
  start(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/stop")
  stop(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/status")
  status(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/leads")
  leads(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/leads")
  enrollLeads(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Delete(":id/leads/:leadId")
  removeLead(@Param("id") _id: string, @Param("leadId") _leadId: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/leads/:leadId/stage")
  leadStage(@Param("id") _id: string, @Param("leadId") _leadId: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/settings/frequency")
  getFrequency(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Put(":id/settings/frequency")
  saveFrequency(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/settings/schedule")
  getSchedule(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Put(":id/settings/schedule")
  saveSchedule(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/share")
  share(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/analytics")
  analytics(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
