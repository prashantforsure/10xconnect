import {
  Controller,
  Delete,
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
export class ApiKeysService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("api-keys")
export class ApiKeysController {
  @Get()
  list(): never {
    throw new NotImplementedException();
  }

  @Post()
  create(): never {
    throw new NotImplementedException();
  }

  @Delete(":id")
  remove(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
