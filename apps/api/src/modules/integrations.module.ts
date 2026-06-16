import {
  Controller,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class IntegrationsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("integrations")
export class IntegrationsController {
  @Get()
  list(): never {
    throw new NotImplementedException();
  }

  @Post(":provider/connect")
  connect(@Param("provider") _provider: string): never {
    throw new NotImplementedException();
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("affiliate")
export class AffiliateController {
  @Get()
  dashboard(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [IntegrationsController, AffiliateController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
