import {
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class CampaignsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("campaigns")
export class CampaignsController {
  @Get()
  list(): never {
    throw new NotImplementedException();
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
