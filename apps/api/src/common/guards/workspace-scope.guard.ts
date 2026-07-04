import type { DB } from "@10xconnect/db";
import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Kysely } from "kysely";

import type { ApiKeyPrincipal } from "../../auth/api-key-auth.service";
import type { AuthUser } from "../../auth/auth-user.interface";
import { KYSELY_DB } from "../../database/database.module";

type ScopedRequest = Request & {
  user?: AuthUser;
  apiKey?: ApiKeyPrincipal;
  workspaceId?: string;
};

const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Resolves the active workspace from the X-Workspace-Id header, verifies the
 * authenticated user is a member (via memberships), and attaches it to the
 * request. Runs after the global auth guard. Rejects non-members with 403.
 */
@Injectable()
export class WorkspaceScopeGuard implements CanActivate {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScopedRequest>();

    // Public-API path: the key already pinned the workspace in the auth guard.
    // There is no user/membership to check; a mismatching header is an error.
    if (request.apiKey) {
      const header = request.headers[WORKSPACE_HEADER];
      const headerWorkspaceId = Array.isArray(header) ? header[0] : header;
      if (headerWorkspaceId && headerWorkspaceId !== request.apiKey.workspaceId) {
        throw new ForbiddenException("X-Workspace-Id does not match the API key's workspace");
      }
      request.workspaceId = request.apiKey.workspaceId;
      return true;
    }

    const user = request.user;
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    const header = request.headers[WORKSPACE_HEADER];
    const workspaceId = Array.isArray(header) ? header[0] : header;
    if (!workspaceId) {
      throw new BadRequestException("X-Workspace-Id header is required");
    }

    const membership = await this.db
      .selectFrom("memberships")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    request.workspaceId = workspaceId;
    return true;
  }
}
