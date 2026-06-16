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
} from "@nestjs/common";

// Cross-workspace management surface — auth-only (membership is resolved per :id
// in Step 5), so no WorkspaceScopeGuard here. Stubs until Step 5/6.

@Injectable()
export class WorkspacesService {}

@Controller("workspaces")
export class WorkspacesController {
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

  @Get(":id/members")
  listMembers(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/members")
  inviteMember(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Patch(":id/members/:userId")
  updateMember(@Param("id") _id: string, @Param("userId") _userId: string): never {
    throw new NotImplementedException();
  }

  @Delete(":id/members/:userId")
  removeMember(@Param("id") _id: string, @Param("userId") _userId: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
