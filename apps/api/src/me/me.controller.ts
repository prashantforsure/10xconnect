import { Controller, Get } from "@nestjs/common";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";

// Auth-only (no workspace scope). Protected by the global SupabaseAuthGuard.
@Controller("me")
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser): { id: string; email?: string } {
    return { id: user.id, email: user.email };
  }
}
