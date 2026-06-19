import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import type { AuthUser } from "../../auth/auth-user.interface";
import { CurrentUser } from "../../auth/current-user.decorator";
import { WorkspaceId } from "../../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";

import { type ConnectionsResult, ConnectionsService } from "./connections.service";
import {
  type BulkActionDto,
  bulkActionSchema,
  type ConnectionsQueryDto,
  connectionsQuerySchema,
  type FindRequestDto,
  findRequestSchema,
  type ImportRequestDto,
  importRequestSchema,
  type ListLeadsQueryDto,
  listLeadsQuerySchema,
  type UpdateLeadDto,
  updateLeadSchema,
} from "./dto";
import { EnrichmentService } from "./enrichment.service";
import { type ImportJobView, ImportService } from "./import.service";
import { type LeadDetail, type LeadListResult, LeadsService } from "./leads.service";

@UseGuards(WorkspaceScopeGuard)
@Controller("leads")
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly imports: ImportService,
    private readonly connections: ConnectionsService,
    private readonly enrichment: EnrichmentService,
  ) {}

  // --- import + find (CLAUDE.md §8) -----------------------------------------

  @Post("import")
  import(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importRequestSchema)) body: ImportRequestDto,
  ): Promise<ImportJobView> {
    return this.imports.startImport(workspaceId, user.id, body);
  }

  @Post("find")
  find(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(findRequestSchema)) body: FindRequestDto,
  ): Promise<ImportJobView> {
    // The built-in lead finder is a lead_finder import (unified pipeline §8).
    return this.imports.startImport(workspaceId, user.id, { source: "lead_finder", ...body });
  }

  @Get("import-jobs")
  listImportJobs(@WorkspaceId() workspaceId: string): Promise<ImportJobView[]> {
    return this.imports.listJobs(workspaceId);
  }

  @Get("import-jobs/:id")
  getImportJob(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ImportJobView> {
    return this.imports.getJob(workspaceId, id);
  }

  // Browse the connected account's 1st-degree connections (live, not persisted).
  // Declared before the `:id` route so the literal path isn't parsed as a UUID.
  @Get("connections")
  listConnections(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(connectionsQuerySchema)) query: ConnectionsQueryDto,
  ): Promise<ConnectionsResult> {
    return this.connections.list(workspaceId, query);
  }

  // --- bulk multi-select actions --------------------------------------------

  @Post("bulk")
  bulk(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(bulkActionSchema)) body: BulkActionDto,
  ): Promise<{ affected: number }> {
    return this.leads.bulk(workspaceId, body);
  }

  // --- CRUD -----------------------------------------------------------------

  @Get()
  list(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQueryDto,
  ): Promise<LeadListResult> {
    return this.leads.list(workspaceId, query);
  }

  @Get(":id")
  get(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.get(workspaceId, id);
  }

  @Patch(":id")
  update(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadDto,
  ): ReturnType<LeadsService["update"]> {
    return this.leads.update(workspaceId, id, body);
  }

  @Delete(":id")
  remove(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.leads.remove(workspaceId, id);
  }

  @Post(":id/enrich")
  async enrich(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ id: string; enrichStatus: string }> {
    const status = await this.enrichment.enrichLead(workspaceId, id);
    return { id, enrichStatus: status };
  }
}
