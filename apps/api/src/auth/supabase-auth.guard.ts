import { env } from "@10xconnect/config";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { jwtVerify } from "jose";

import type { AuthUser } from "./auth-user.interface";

type AuthenticatedRequest = Request & { user?: AuthUser };

/**
 * Verifies the Supabase access-token JWT (HS256, signed with the project's JWT
 * secret) on protected routes and attaches the authenticated user to the request.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const secret = env.SUPABASE_JWT_SECRET;
    if (!secret) {
      // Misconfiguration, not an auth failure -> surface as a server error.
      throw new Error("SUPABASE_JWT_SECRET is not configured");
    }

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
      });

      if (!payload.sub) {
        throw new UnauthorizedException("Invalid token");
      }

      request.user = {
        id: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(" ");
  return scheme === "Bearer" && value ? value : null;
}
