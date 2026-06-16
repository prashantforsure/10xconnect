import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Injects the active workspace id resolved by WorkspaceScopeGuard. */
export const WorkspaceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request & { workspaceId?: string }>();
    if (!request.workspaceId) {
      throw new Error("WorkspaceId used on a route without WorkspaceScopeGuard");
    }
    return request.workspaceId;
  },
);
