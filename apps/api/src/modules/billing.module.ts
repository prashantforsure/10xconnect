import {
  Controller,
  Get,
  Injectable,
  Module,
  NotImplementedException,
  Post,
  UseGuards,
} from "@nestjs/common";

import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";

@Injectable()
export class BillingService {}

@UseGuards(WorkspaceScopeGuard)
@Controller("billing")
export class BillingController {
  @Get("subscription")
  subscription(): never {
    throw new NotImplementedException();
  }

  @Post("slots")
  slots(): never {
    throw new NotImplementedException();
  }

  @Post("checkout")
  checkout(): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
