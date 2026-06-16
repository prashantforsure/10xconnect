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
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class ListsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("lists")
export class ListsController {
  @Get()
  list(): never {
    throw new NotImplementedException();
  }

  @Post()
  create(): never {
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
}

@Module({
  controllers: [ListsController],
  providers: [ListsService],
})
export class ListsModule {}
