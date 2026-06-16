import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { AuthUser } from "./auth-user.interface";

/** Injects the authenticated user attached by SupabaseAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user) {
      throw new Error("CurrentUser used on a route without SupabaseAuthGuard");
    }
    return request.user;
  },
);
