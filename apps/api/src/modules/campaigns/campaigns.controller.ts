import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";

import { WorkspaceId } from "../../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";

import { CampaignRunService } from "./campaign-run.service";
import { type CampaignView, CampaignsService } from "./campaigns.service";
import {
  createCampaignSchema,
  type CreateCampaignDto,
  enrollLeadsSchema,
  type EnrollLeadsDto,
  generateCampaignSchema,
  type GenerateCampaignDto,
  saveFrequencySchema,
  type SaveFrequencyDto,
  saveScheduleSchema,
  type SaveScheduleDto,
  saveSequenceSchema,
  type SaveSequenceDto,
  updateCampaignSchema,
  type UpdateCampaignDto,
} from "./dto";

@UseGuards(WorkspaceScopeGuard)
@Controller("campaigns")
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly run: CampaignRunService,
  ) {}

  @Get()
  list(@WorkspaceId() workspaceId: string): Promise<CampaignView[]> {
    return this.campaigns.list(workspaceId);
  }

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignDto,
  ): Promise<CampaignView> {
    return this.campaigns.create(workspaceId, body);
  }

  @Get(":id")
  detail(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<CampaignView> {
    return this.campaigns.detail(workspaceId, id);
  }

  @Patch(":id")
  update(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignDto,
  ): Promise<CampaignView> {
    return this.campaigns.update(workspaceId, id, body);
  }

  @Delete(":id")
  remove(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.campaigns.remove(workspaceId, id);
  }

  @Get(":id/status")
  status(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.campaigns.getStatus(workspaceId, id);
  }

  // --- Frequency + Schedule settings ---------------------------------------

  @Get(":id/settings/frequency")
  getFrequency(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.campaigns.getFrequency(workspaceId, id);
  }

  @Put(":id/settings/frequency")
  saveFrequency(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveFrequencySchema)) body: SaveFrequencyDto,
  ) {
    return this.campaigns.saveFrequency(workspaceId, id, body);
  }

  @Get(":id/settings/schedule")
  getSchedule(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.campaigns.getSchedule(workspaceId, id);
  }

  @Put(":id/settings/schedule")
  saveSchedule(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveScheduleSchema)) body: SaveScheduleDto,
  ) {
    return this.campaigns.saveSchedule(workspaceId, id, body);
  }

  // --- Sequence graph ------------------------------------------------------

  @Get(":id/sequence")
  getSequence(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.getSequence(workspaceId, id);
  }

  @Put(":id/sequence")
  saveSequence(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveSequenceSchema)) body: SaveSequenceDto,
  ) {
    return this.run.saveSequence(workspaceId, id, body);
  }

  @Get(":id/sequence/node-counts")
  nodeCounts(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.nodeCounts(workspaceId, id);
  }

  @Get(":id/sequence/node-stats")
  nodeStats(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.nodeStats(workspaceId, id);
  }

  @Get(":id/preview-samples")
  previewSamples(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.previewSamples(workspaceId, id);
  }

  @Post(":id/generate")
  generate(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(generateCampaignSchema)) body: GenerateCampaignDto,
  ) {
    return this.run.generate(workspaceId, id, body);
  }

  // --- Run / stop ----------------------------------------------------------

  @Post(":id/start")
  start(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.start(workspaceId, id);
  }

  @Post(":id/stop")
  stop(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.stop(workspaceId, id);
  }

  // --- Leads ---------------------------------------------------------------

  @Get(":id/leads")
  leads(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.listLeads(workspaceId, id);
  }

  @Post(":id/leads")
  enrollLeads(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(enrollLeadsSchema)) body: EnrollLeadsDto,
  ) {
    return this.run.enroll(workspaceId, id, body);
  }

  @Delete(":id/leads/:leadId")
  removeLead(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Param("leadId") leadId: string,
  ) {
    return this.run.removeLead(workspaceId, id, leadId);
  }

  @Get(":id/leads/:leadId/stage")
  leadStage(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Param("leadId") leadId: string,
  ) {
    return this.run.leadStage(workspaceId, id, leadId);
  }

  @Post(":id/share")
  share(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.run.share(workspaceId, id);
  }
}
