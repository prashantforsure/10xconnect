import {
  Controller,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class AccountsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("accounts")
export class AccountsController {
  @Get()
  list(): never {
    throw new NotImplementedException();
  }

  @Post("connect")
  connect(): never {
    throw new NotImplementedException();
  }

  @Get(":id")
  detail(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get(":id/health")
  health(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Patch(":id")
  update(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/disconnect")
  disconnect(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/pause")
  pause(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/resume")
  resume(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
