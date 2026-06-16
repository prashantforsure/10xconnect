// Role-based access control matrix (CLAUDE.md §1/§10). This is the AUTHORITATIVE
// permission definition: the API enforces it server-side via the RBAC guard.
// The web may import `can()` for UI gating, but the server is the source of truth.
//
// Capabilities the matrix cannot express on its own (enforced in the service):
//   - granting or modifying the `owner` role requires `workspace:transfer_ownership`
//     (Owner only) — so an Admin can manage Members/Admins but never Owners;
//   - the last Owner of a workspace can never be removed or demoted.

export type Role = "owner" | "admin" | "member";

export type Permission =
  | "workspace:update"
  | "workspace:delete"
  | "workspace:transfer_ownership"
  | "billing:manage"
  | "members:read"
  | "members:invite"
  | "members:update_role"
  | "members:remove";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    "workspace:update",
    "workspace:delete",
    "workspace:transfer_ownership",
    "billing:manage",
    "members:read",
    "members:invite",
    "members:update_role",
    "members:remove",
  ],
  admin: [
    "workspace:update",
    "members:read",
    "members:invite",
    "members:update_role",
    "members:remove",
  ],
  member: ["members:read"],
};

export const ROLES: readonly Role[] = ["owner", "admin", "member"];

/** True if `role` is granted `permission` by the matrix. */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** All permissions granted to a role. */
export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
