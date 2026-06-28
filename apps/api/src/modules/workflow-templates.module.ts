// Workflow templates API (Phase 6): save a whole campaign's SHAPE as a reusable,
// shareable template, list/apply it (apply clones a fresh DRAFT campaign with 0
// contacts and surfaces the required_inputs the user must supply), and edit/delete
// it. The strip + clone logic lives in @10xconnect/engine; this is a thin
// workspace-scoped surface. Editing a template NEVER touches campaigns already
// cloned from it (frozen copies).

import type { DB, WorkflowTemplateScope } from "@10xconnect/db";
import {
  applyWorkflowTemplate,
  deleteWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplates,
  saveWorkflowTemplate,
  type TemplateNode,
  updateWorkflowTemplate,
} from "@10xconnect/engine";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
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

const SCOPES = ["private", "workspace", "community"] as const;

const saveSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  scope: z.enum(SCOPES).optional(),
});
type SaveDto = z.infer<typeof saveSchema>;

const applySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});
type ApplyDto = z.infer<typeof applySchema>;

// A structure-only template node (edges by template-local key); config is permissive.
const templateNodeSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["action", "condition"]),
  type: z.string().min(1).max(64),
  config: z.record(z.unknown()).default({}),
  next: z.string().nullable().optional(),
  true: z.string().nullable().optional(),
  false: z.string().nullable().optional(),
  delayDays: z.number().int().min(0).max(365).nullable().optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    scope: z.enum(SCOPES).optional(),
    graph: z.array(templateNodeSchema).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
type UpdateDto = z.infer<typeof updateSchema>;

@Injectable()
export class WorkflowTemplatesService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  list(workspaceId: string, scope?: string) {
    const s = (SCOPES as readonly string[]).includes(scope ?? "") ? (scope as WorkflowTemplateScope) : undefined;
    return listWorkflowTemplates(this.db, { workspaceId, scope: s });
  }

  async get(workspaceId: string, id: string) {
    const t = await getWorkflowTemplate(this.db, { workspaceId, id });
    if (!t) throw new NotFoundException("Workflow template not found");
    return t;
  }

  async save(workspaceId: string, userId: string, dto: SaveDto) {
    const t = await saveWorkflowTemplate(this.db, {
      workspaceId,
      userId,
      campaignId: dto.campaignId,
      name: dto.name,
      scope: dto.scope,
    });
    if (!t) throw new NotFoundException("Campaign not found");
    return t;
  }

  async apply(workspaceId: string, id: string, dto: ApplyDto) {
    const res = await applyWorkflowTemplate(this.db, { workspaceId, templateId: id, name: dto.name });
    if (!res) throw new NotFoundException("Workflow template not found");
    return res;
  }

  async update(workspaceId: string, id: string, dto: UpdateDto) {
    const t = await updateWorkflowTemplate(this.db, {
      workspaceId,
      id,
      name: dto.name,
      scope: dto.scope,
      graph: dto.graph as TemplateNode[] | undefined,
    });
    if (!t) throw new NotFoundException("Workflow template not found");
    return t;
  }

  async remove(workspaceId: string, id: string) {
    await deleteWorkflowTemplate(this.db, { workspaceId, id });
    return { ok: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("workflow-templates")
export class WorkflowTemplatesController {
  constructor(private readonly svc: WorkflowTemplatesService) {}

  @Get()
  list(@WorkspaceId() ws: string, @Query("scope") scope?: string) {
    return this.svc.list(ws, scope);
  }

  @Post()
  save(
    @WorkspaceId() ws: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(saveSchema)) body: SaveDto,
  ) {
    return this.svc.save(ws, user.id, body);
  }

  @Get(":id")
  get(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.svc.get(ws, id);
  }

  @Post(":id/apply")
  apply(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(applySchema)) body: ApplyDto,
  ) {
    return this.svc.apply(ws, id, body);
  }

  @Patch(":id")
  update(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateDto,
  ) {
    return this.svc.update(ws, id, body);
  }

  @Delete(":id")
  remove(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.svc.remove(ws, id);
  }
}

@Module({ controllers: [WorkflowTemplatesController], providers: [WorkflowTemplatesService] })
export class WorkflowTemplatesModule {}
