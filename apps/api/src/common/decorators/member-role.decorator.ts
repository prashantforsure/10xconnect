import type { Role } from "@10xconnect/core";
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Injects the caller's role in the workspace, resolved by WorkspaceRbacGuard. */
export const MemberRole = createParamDecorator((_data: unknown, context: ExecutionContext): Role => {
  const request = context.switchToHttp().getRequest<Request & { memberRole?: Role }>();
  if (!request.memberRole) {
    throw new Error("MemberRole used on a route without WorkspaceRbacGuard");
  }
  return request.memberRole;
});
