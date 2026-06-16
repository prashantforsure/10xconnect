import { type Permission, type Role, can } from "@10xconnect/core";
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
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Kysely } from "kysely";

import type { AuthUser } from "../../auth/auth-user.interface";
import { KYSELY_DB } from "../../database/database.module";
import { PERMISSION_KEY } from "../decorators/require-permission.decorator";

type RbacRequest = Request & { user?: AuthUser; workspaceId?: string; memberRole?: Role };

/**
 * RBAC for routes scoped by a `:id` workspace path param (the cross-workspace
 * management surface). Resolves the caller's role in that workspace, attaches it
 * to the request, and enforces any @RequirePermission(...) declared on the route.
 * Non-members are rejected with 403; missing permissions with 403.
 */
@Injectable()
export class WorkspaceRbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RbacRequest>();

    const user = request.user;
    if (!user) {
      throw new UnauthorizedException("Authentication required");
    }

    const idParam = request.params.id;
    const workspaceId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!workspaceId) {
      throw new BadRequestException("Workspace id is required");
    }

    const membership = await this.db
      .selectFrom("memberships")
      .select("role")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", user.id)
      .executeTakeFirst();

    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    request.workspaceId = workspaceId;
    request.memberRole = membership.role;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length) {
      for (const permission of required) {
        if (!can(membership.role, permission)) {
          throw new ForbiddenException(`Missing required permission: ${permission}`);
        }
      }
    }

    return true;
  }
}
