import { createParamDecorator, ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { ApiKeyPrincipal } from "./api-key-auth.service";
import type { AuthUser } from "./auth-user.interface";

type AuthedRequest = Request & { user?: AuthUser; apiKey?: ApiKeyPrincipal };

/**
 * Injects the authenticated user attached by SupabaseAuthGuard. API-key
 * requests carry no user — routes that REQUIRE one reject keys with a clean
 * 403 (not a 500). Routes that merely attribute an action to a user should use
 * OptionalCurrentUser instead so they stay reachable from the public API.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user) {
      if (request.apiKey) {
        throw new ForbiddenException(
          "This endpoint requires a user session and is not available to API keys",
        );
      }
      throw new Error("CurrentUser used on a route without SupabaseAuthGuard");
    }
    return request.user;
  },
);

/** Like CurrentUser, but resolves to undefined for API-key requests. */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    return request.user;
  },
);
