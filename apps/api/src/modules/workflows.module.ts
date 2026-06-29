// Saved workflows API (builder-only): save the current builder canvas SHAPE as a
// reusable workflow, list a workspace's saved workflows, and delete one. The
// strip + persistence logic lives in @10xconnect/engine; this is a thin
// workspace-scoped surface. Distinct from /workflow-templates (whole-campaign
// clones) — a saved workflow is loaded straight back into the builder canvas.

import type { DB } from "@10xconnect/db";
import {
  createSavedWorkflow,
  deleteSavedWorkflow,
  listSavedWorkflows,
  type SavedWorkflowNode,
} from "@10xconnect/engine";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// A builder canvas node (matches apps/web lib/campaigns/graph.ts GraphNode);
// config is permissive and gets stripped to a shape-only skeleton on save.
const workflowNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["action", "condition"]),
  type: z.string().min(1).max(64),
  config: z.record(z.unknown()).default({}),
  next: z.string().nullable().default(null),
  true: z.string().nullable().default(null),
  false: z.string().nullable().default(null),
  delayDays: z.number().int().min(0).max(365).nullable().default(null),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  graph: z.array(workflowNodeSchema).min(1).max(200),
});
type SaveDto = z.infer<typeof saveSchema>;

@Injectable()
export class WorkflowsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  list(workspaceId: string) {
    return listSavedWorkflows(this.db, { workspaceId });
  }

  save(workspaceId: string, userId: string, dto: SaveDto) {
    return createSavedWorkflow(this.db, {
      workspaceId,
      userId,
      name: dto.name,
      graph: dto.graph as SavedWorkflowNode[],
    });
  }

  async remove(workspaceId: string, id: string) {
    await deleteSavedWorkflow(this.db, { workspaceId, id });
    return { ok: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly svc: WorkflowsService) {}

  @Get()
  list(@WorkspaceId() ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  save(
    @WorkspaceId() ws: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(saveSchema)) body: SaveDto,
  ) {
    return this.svc.save(ws, user.id, body);
  }

  @Delete(":id")
  remove(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.svc.remove(ws, id);
  }
}

@Module({ controllers: [WorkflowsController], providers: [WorkflowsService] })
export class WorkflowsModule {}
