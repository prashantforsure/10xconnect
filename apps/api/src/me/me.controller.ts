import { Controller, Get, UseGuards } from "@nestjs/common";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";

@Controller("me")
@UseGuards(SupabaseAuthGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser): { id: string; email?: string } {
    return { id: user.id, email: user.email };
  }
}
