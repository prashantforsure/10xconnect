import type { Permission } from "@10xconnect/core";
import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "requiredPermissions";

/**
 * Declares the RBAC permission(s) a route requires. Enforced by
 * WorkspaceRbacGuard against the caller's role in the workspace (`:id` param).
 * Without it, the guard only requires workspace membership.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
