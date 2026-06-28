// Personalization API (Phase 5): the contact-variable registry, the per-prospect
// preview (resolve a node's message across contacts, cached for dispatch reuse),
// and the AI prompt-template library (named, variable-driven, shareable by scope).
// Heavy lifting lives in @10xconnect/engine; this is a thin workspace-scoped surface.

import { createTextAdapter } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import { CONTACT_VARIABLES, type ChannelAdapter } from "@10xconnect/core";
import type { DB, PromptTemplateScope } from "@10xconnect/db";
import {
  deleteTemplate,
  dispatchConfigFromEnv,
  type EngineDeps,
  listTemplates,
  previewNode,
  saveTemplate,
  updateTemplate,
  useTemplate,
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

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

const previewSchema = z.object({
  leadIds: z.array(z.string().uuid()).max(20).optional(),
  sampleSize: z.number().int().min(1).max(12).optional(),
  force: z.boolean().optional(),
});
type PreviewDto = z.infer<typeof previewSchema>;

const SCOPES = ["private", "workspace", "community"] as const;
const saveTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  variables: z.array(z.string().max(60)).max(50).optional(),
  scope: z.enum(SCOPES).optional(),
});
type SaveTemplateDto = z.infer<typeof saveTemplateSchema>;

const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    variables: z.array(z.string().max(60)).max(50).optional(),
    scope: z.enum(SCOPES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;

@Injectable()
export class PersonalizationService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
  ) {}

  private deps(): EngineDeps {
    return {
      db: this.db,
      adapter: this.adapter,
      config: dispatchConfigFromEnv(),
      textAdapter: createTextAdapter(),
      modelLabel: env.LLM_PROVIDER === "mock" ? "mock" : env.LLM_MODEL,
    };
  }

  /** The full contact-variable palette (registry) for the composer + docs. */
  variables() {
    return CONTACT_VARIABLES;
  }

  /** Per-prospect preview of a node's message across sample/selected contacts. */
  async preview(workspaceId: string, campaignId: string, nodeId: string, dto: PreviewDto) {
    const node = await this.db
      .selectFrom("sequence_nodes")
      .select(["id", "config"])
      .where("workspace_id", "=", workspaceId)
      .where("campaign_id", "=", campaignId)
      .where("id", "=", nodeId)
      .executeTakeFirst();
    if (!node) throw new NotFoundException("Node not found");

    const config = (node.config && typeof node.config === "object" ? node.config : {}) as Record<string, unknown>;
    return previewNode(this.deps(), {
      workspaceId,
      campaignId,
      nodeId,
      config,
      leadIds: dto.leadIds,
      sampleSize: dto.sampleSize,
      force: dto.force,
    });
  }

  // --- Template library ----------------------------------------------------

  listTemplates(workspaceId: string, scope?: string) {
    const s = (SCOPES as readonly string[]).includes(scope ?? "") ? (scope as PromptTemplateScope) : undefined;
    return listTemplates(this.db, { workspaceId, scope: s });
  }

  saveTemplate(workspaceId: string, userId: string, dto: SaveTemplateDto) {
    return saveTemplate(this.db, { workspaceId, userId, ...dto });
  }

  async updateTemplate(workspaceId: string, id: string, dto: UpdateTemplateDto) {
    const t = await updateTemplate(this.db, { workspaceId, id, ...dto });
    if (!t) throw new NotFoundException("Template not found");
    return t;
  }

  async useTemplate(workspaceId: string, id: string) {
    const r = await useTemplate(this.db, { workspaceId, id });
    if (r.runCount < 0) throw new NotFoundException("Template not found");
    return r;
  }

  async deleteTemplate(workspaceId: string, id: string) {
    await deleteTemplate(this.db, { workspaceId, id });
    return { ok: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller()
export class PersonalizationController {
  constructor(private readonly svc: PersonalizationService) {}

  @Get("personalization/variables")
  variables() {
    return this.svc.variables();
  }

  @Post("campaigns/:id/nodes/:nodeId/preview")
  preview(
    @WorkspaceId() ws: string,
    @Param("id") campaignId: string,
    @Param("nodeId") nodeId: string,
    @Body(new ZodValidationPipe(previewSchema)) body: PreviewDto,
  ) {
    return this.svc.preview(ws, campaignId, nodeId, body);
  }

  @Get("ai/templates")
  list(@WorkspaceId() ws: string, @Query("scope") scope?: string) {
    return this.svc.listTemplates(ws, scope);
  }

  @Post("ai/templates")
  save(
    @WorkspaceId() ws: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(saveTemplateSchema)) body: SaveTemplateDto,
  ) {
    return this.svc.saveTemplate(ws, user.id, body);
  }

  @Patch("ai/templates/:id")
  update(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: UpdateTemplateDto,
  ) {
    return this.svc.updateTemplate(ws, id, body);
  }

  @Post("ai/templates/:id/use")
  use(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.svc.useTemplate(ws, id);
  }

  @Delete("ai/templates/:id")
  remove(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.svc.deleteTemplate(ws, id);
  }
}

@Module({ controllers: [PersonalizationController], providers: [PersonalizationService] })
export class PersonalizationModule {}
