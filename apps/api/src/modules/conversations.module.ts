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
export class ConversationsService {}

@UseGuards(WorkspaceScopeGuard)
@Controller()
export class ConversationsController {
  @Get("conversations")
  list(): never {
    throw new NotImplementedException();
  }

  @Get("conversations/:id")
  detail(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post("conversations/:id/reply")
  reply(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Patch("conversations/:id")
  update(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Get("saved-responses")
  listSavedResponses(): never {
    throw new NotImplementedException();
  }

  @Post("saved-responses")
  createSavedResponse(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
