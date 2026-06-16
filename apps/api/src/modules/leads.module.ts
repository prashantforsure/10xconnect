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
export class LeadsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("leads")
export class LeadsController {
  @Post("import")
  import(): never {
    throw new NotImplementedException();
  }

  @Post("find")
  find(): never {
    throw new NotImplementedException();
  }

  @Post("bulk")
  bulk(): never {
    throw new NotImplementedException();
  }

  @Get()
  list(): never {
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

  @Post(":id/enrich")
  enrich(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
