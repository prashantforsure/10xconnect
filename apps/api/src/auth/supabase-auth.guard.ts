import { env } from "@10xconnect/config";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";

import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";

import {
  API_KEY_TOKEN_PREFIX,
  ApiKeyAuthService,
  type ApiKeyPrincipal,
} from "./api-key-auth.service";
import type { AuthUser } from "./auth-user.interface";

type AuthenticatedRequest = Request & {
  user?: AuthUser;
  apiKey?: ApiKeyPrincipal;
  workspaceId?: string;
};

/** Thrown for server misconfiguration (missing env), surfaced as 500 not 401. */
class AuthConfigError extends Error {}

// Remote JWKS for asymmetric (ES256/RS256) signing keys, memoized + cached by jose.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!env.SUPABASE_URL) {
    throw new AuthConfigError("SUPABASE_URL is not configured");
  }
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

async function verifyAccessToken(token: string): Promise<JWTPayload> {
  // Newer Supabase projects sign access tokens with asymmetric keys (ES256/RS256)
  // verified via JWKS; legacy projects use HS256 with the shared JWT secret.
  const { alg } = decodeProtectedHeader(token);

  if (alg === "HS256") {
    const secret = env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new AuthConfigError("SUPABASE_JWT_SECRET is not configured");
    }
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    return payload;
  }

  const { payload } = await jwtVerify(token, getJwks());
  return payload;
}

/**
 * Global guard: verifies the Supabase access-token JWT and attaches the user to
 * the request. Routes marked with @Public() bypass it (e.g. GET /health).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    // Public-API path: a `10xc_` bearer key authenticates as a WORKSPACE, not a
    // user. The key pins the workspace (no X-Workspace-Id needed); request.user
    // stays undefined; denylist/read-only/rate-limit enforced by the service.
    if (token.startsWith(API_KEY_TOKEN_PREFIX)) {
      const principal = await this.apiKeys.authorize(token, request.method, request.path);
      request.apiKey = principal;
      request.workspaceId = principal.workspaceId;
      return true;
    }

    let payload: JWTPayload;
    try {
      payload = await verifyAccessToken(token);
    } catch (error) {
      if (error instanceof AuthConfigError) {
        throw error; // misconfiguration -> 500
      }
      throw new UnauthorizedException("Invalid or expired token");
    }

    if (!payload.sub) {
      throw new UnauthorizedException("Invalid token");
    }

    request.user = {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
    return true;
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
