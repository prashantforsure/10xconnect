import {
  Controller,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class AnalyticsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("analytics")
export class AnalyticsController {
  @Get("workspace")
  workspace(): never {
    throw new NotImplementedException();
  }

  @Get("campaign/:id")
  campaign(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get("accounts")
  accounts(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
