// Conversation-brain API (Phase 2): knowledge base ingestion, campaign brain
// config, and AI-draft approval. The heavy lifting (chunk/embed/retrieve/draft/
// reflect) lives in @10xconnect/engine; this is a thin, workspace-scoped surface.

import { createEmbeddingAdapter, createTextAdapter } from "@10xconnect/adapters";
import { env } from "@10xconnect/config";
import { budgetFrom, type ChannelAdapter } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  approveDraft,
  discardDraft,
  dispatchConfigFromEnv,
  type EngineDeps,
  ingestText,
  utcDay,
} from "@10xconnect/engine";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { type Kysely, sql } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

import { extractDocumentText, htmlToText, type UploadedDoc } from "./document-extract";

/** Max upload size for a knowledge-base document (10 MB). */
const MAX_DOC_BYTES = 10 * 1024 * 1024;

const createKbSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
type CreateKbDto = z.infer<typeof createKbSchema>;

const ingestSchema = z
  .object({
    text: z.string().trim().min(1).max(200_000).optional(),
    url: z.string().url().optional(),
    source: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.text || v.url, { message: "Provide text or a url to ingest" });
type IngestDto = z.infer<typeof ingestSchema>;

export const brainConfigSchema = z
  .object({
    objective: z
      .object({
        goal: z.string().max(2000).optional(),
        offer: z.string().max(2000).optional(),
        success_criteria: z.string().max(2000).optional(),
        icp: z.string().max(2000).optional(),
        cta: z.string().max(500).optional(),
      })
      .partial()
      .nullable()
      .optional(),
    guardrails: z
      .object({
        never_discuss: z.array(z.string().max(200)).max(50).optional(),
        escalate_on: z.array(z.string().max(200)).max(50).optional(),
      })
      .partial()
      .optional(),
    voice: z
      .object({
        tone: z.string().max(1000).optional(),
        samples: z.array(z.string().max(4000)).max(10).optional(),
      })
      .partial()
      .optional(),
    autonomy: z
      .object({
        mode: z.enum(["approve_all", "auto_easy_escalate_hard", "full_auto"]),
        confidence_threshold: z.number().min(0).max(1).optional(),
      })
      .optional(),
    // Phase 3 — conversation spam caps + LLM budget.
    limits: z
      .object({
        max_ai_turns: z.number().int().min(0).max(100).optional(),
        cooldown_minutes: z.number().int().min(0).max(10_080).optional(),
      })
      .partial()
      .optional(),
    budget: z
      .object({
        daily_usd_cap: z.number().min(0).max(100_000).nullable().optional(),
        alert_at_pct: z.number().min(0).max(1).optional(),
      })
      .partial()
      .optional(),
    knowledgeBaseId: z.string().uuid().nullable().optional(),
    voiceProfileId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
type BrainConfigDto = z.infer<typeof brainConfigSchema>;

const approveSchema = z.object({ editedBody: z.string().trim().min(1).max(8000).optional() });
type ApproveDto = z.infer<typeof approveSchema>;

@Injectable()
export class BrainService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
  ) {}

  /** EngineDeps for brain orchestration (approve/discard/ingest). */
  private deps(): EngineDeps {
    return {
      db: this.db,
      adapter: this.adapter,
      config: dispatchConfigFromEnv(),
      textAdapter: createTextAdapter(),
      embeddingAdapter: createEmbeddingAdapter(),
      modelLabel: env.LLM_PROVIDER === "mock" ? "mock" : env.LLM_MODEL,
    };
  }

  async createKb(workspaceId: string, dto: CreateKbDto) {
    return this.db
      .insertInto("knowledge_bases")
      .values({ workspace_id: workspaceId, name: dto.name, description: dto.description ?? null })
      .returning(["id", "name", "description"])
      .executeTakeFirstOrThrow();
  }

  async listKbs(workspaceId: string) {
    const bases = await this.db
      .selectFrom("knowledge_bases")
      .select(["id", "name", "description", "created_at as createdAt"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
    const counts = await this.db
      .selectFrom("kb_chunks")
      .select(["knowledge_base_id as kbId", (eb) => eb.fn.countAll<number>().as("chunks")])
      .where("workspace_id", "=", workspaceId)
      .groupBy("knowledge_base_id")
      .execute();
    const byKb = new Map(counts.map((c) => [c.kbId, Number(c.chunks)]));
    return bases.map((b) => ({ ...b, chunks: byKb.get(b.id) ?? 0 }));
  }

  async ingest(workspaceId: string, kbId: string, dto: IngestDto) {
    const kb = await this.db
      .selectFrom("knowledge_bases")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", kbId)
      .executeTakeFirst();
    if (!kb) throw new NotFoundException("Knowledge base not found");

    const embedder = createEmbeddingAdapter();
    if (!embedder) throw new BadRequestException("Embeddings are not configured (set EMBEDDING/LLM key).");

    let text = dto.text ?? "";
    let source = dto.source ?? "manual";
    if (dto.url) {
      const res = await fetch(dto.url).catch(() => null);
      if (!res?.ok) throw new BadRequestException("Could not fetch the URL.");
      text = htmlToText(await res.text());
      source = dto.source ?? dto.url;
    }
    if (!text.trim()) throw new BadRequestException("Nothing to ingest (empty content).");

    return ingestText(this.db, embedder, { workspaceId, knowledgeBaseId: kbId, text, source });
  }

  /** Ingest an uploaded document (PDF/DOCX/text/HTML) into a knowledge base. */
  async ingestFile(workspaceId: string, kbId: string, file: UploadedDoc | undefined) {
    if (!file) throw new BadRequestException("No file uploaded (field name must be 'file').");
    if (file.size > MAX_DOC_BYTES) throw new BadRequestException("File too large (max 10 MB).");

    const kb = await this.db
      .selectFrom("knowledge_bases")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", kbId)
      .executeTakeFirst();
    if (!kb) throw new NotFoundException("Knowledge base not found");

    const embedder = createEmbeddingAdapter();
    if (!embedder) throw new BadRequestException("Embeddings are not configured (set EMBEDDING/LLM key).");

    let text: string;
    try {
      text = await extractDocumentText(file);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Could not read the document.");
    }
    if (!text.trim()) throw new BadRequestException("No readable text found in the document.");

    return ingestText(this.db, embedder, {
      workspaceId,
      knowledgeBaseId: kbId,
      text,
      source: file.originalname || "document",
    });
  }

  /** List ingested sources in a KB with per-source chunk counts. */
  async listSources(workspaceId: string, kbId: string) {
    const rows = await this.db
      .selectFrom("kb_chunks")
      .select((eb) => [
        sql<string>`coalesce(metadata->>'source', 'manual')`.as("source"),
        eb.fn.countAll<number>().as("chunks"),
      ])
      .where("workspace_id", "=", workspaceId)
      .where("knowledge_base_id", "=", kbId)
      .groupBy(sql`coalesce(metadata->>'source', 'manual')`)
      .orderBy("source")
      .execute();
    return rows.map((r) => ({ source: r.source, chunks: Number(r.chunks) }));
  }

  /** Delete all chunks ingested from one source (removes that source from the KB). */
  async deleteSource(workspaceId: string, kbId: string, source: string) {
    if (!source) throw new BadRequestException("source is required");
    const res = await this.db
      .deleteFrom("kb_chunks")
      .where("workspace_id", "=", workspaceId)
      .where("knowledge_base_id", "=", kbId)
      .where(sql`coalesce(metadata->>'source', 'manual')`, "=", source)
      .executeTakeFirst();
    return { deleted: Number(res.numDeletedRows ?? 0) };
  }

  async getBrain(workspaceId: string, campaignId: string) {
    const c = await this.db
      .selectFrom("campaigns")
      .select([
        "objective",
        "guardrails",
        "voice",
        "autonomy",
        "limits",
        "budget",
        "knowledge_base_id as knowledgeBaseId",
        "voice_profile_id as voiceProfileId",
      ])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .executeTakeFirst();
    if (!c) throw new NotFoundException("Campaign not found");
    return c;
  }

  /** Today's AI spend for a campaign (the budget governor's view). */
  async budgetUsage(workspaceId: string, campaignId: string) {
    const c = await this.db
      .selectFrom("campaigns")
      .select(["budget"])
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .executeTakeFirst();
    if (!c) throw new NotFoundException("Campaign not found");
    const cfg = budgetFrom(c.budget);
    const window = utcDay(new Date());
    const row = await this.db
      .selectFrom("budget_ledger")
      .select(["tokens_used as tokensUsed", "usd_used as usdUsed", "soft_alerted as softAlerted", "hard_stopped as hardStopped"])
      .where("campaign_id", "=", campaignId)
      .where("window", "=", window)
      .executeTakeFirst();
    return {
      window,
      cap: cfg.dailyUsdCap,
      alertAtPct: cfg.alertAtPct,
      tokensUsed: row ? Number(row.tokensUsed) : 0,
      usdUsed: row ? Number(row.usdUsed) : 0,
      softAlerted: row?.softAlerted ?? false,
      hardStopped: row?.hardStopped ?? false,
    };
  }

  async setBrain(workspaceId: string, campaignId: string, dto: BrainConfigDto) {
    const updated = await this.db
      .updateTable("campaigns")
      .set({
        ...(dto.objective !== undefined ? { objective: JSON.stringify(dto.objective) } : {}),
        ...(dto.guardrails !== undefined ? { guardrails: JSON.stringify(dto.guardrails) } : {}),
        ...(dto.voice !== undefined ? { voice: JSON.stringify(dto.voice) } : {}),
        ...(dto.autonomy !== undefined ? { autonomy: JSON.stringify(dto.autonomy) } : {}),
        ...(dto.limits !== undefined ? { limits: JSON.stringify(dto.limits) } : {}),
        ...(dto.budget !== undefined ? { budget: JSON.stringify(dto.budget) } : {}),
        ...(dto.knowledgeBaseId !== undefined ? { knowledge_base_id: dto.knowledgeBaseId } : {}),
        ...(dto.voiceProfileId !== undefined ? { voice_profile_id: dto.voiceProfileId } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", campaignId)
      .returning("id")
      .executeTakeFirst();
    if (!updated) throw new NotFoundException("Campaign not found");
    return { ok: true };
  }

  /** Approve the conversation's latest pending draft (optionally edited). */
  async approve(workspaceId: string, conversationId: string, dto: ApproveDto) {
    const draft = await this.db
      .selectFrom("message_drafts")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("conversation_id", "=", conversationId)
      .where("status", "=", "pending")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!draft) throw new NotFoundException("No pending draft to approve");
    const res = await approveDraft(this.deps(), { workspaceId, draftId: draft.id, editedBody: dto.editedBody });
    if (res.status !== "approved") throw new BadRequestException("Draft could not be approved");
    return { queued: true };
  }

  async discard(workspaceId: string, conversationId: string) {
    const draft = await this.db
      .selectFrom("message_drafts")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("conversation_id", "=", conversationId)
      .where("status", "=", "pending")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!draft) throw new NotFoundException("No pending draft to discard");
    await discardDraft(this.deps(), { workspaceId, draftId: draft.id });
    return { discarded: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller()
export class BrainController {
  constructor(private readonly brain: BrainService) {}

  @Post("knowledge-bases")
  createKb(@WorkspaceId() ws: string, @Body(new ZodValidationPipe(createKbSchema)) body: CreateKbDto) {
    return this.brain.createKb(ws, body);
  }

  @Get("knowledge-bases")
  listKbs(@WorkspaceId() ws: string) {
    return this.brain.listKbs(ws);
  }

  @Post("knowledge-bases/:id/ingest")
  ingest(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ingestSchema)) body: IngestDto,
  ) {
    return this.brain.ingest(ws, id, body);
  }

  @Post("knowledge-bases/:id/ingest-file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_DOC_BYTES } }))
  ingestFile(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @UploadedFile() file: UploadedDoc | undefined,
  ) {
    return this.brain.ingestFile(ws, id, file);
  }

  @Get("knowledge-bases/:id/sources")
  sources(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.brain.listSources(ws, id);
  }

  @Delete("knowledge-bases/:id/sources")
  deleteSource(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Query("source") source: string,
  ) {
    return this.brain.deleteSource(ws, id, source);
  }

  @Get("campaigns/:id/brain")
  getBrain(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.brain.getBrain(ws, id);
  }

  @Put("campaigns/:id/brain")
  setBrain(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(brainConfigSchema)) body: BrainConfigDto,
  ) {
    return this.brain.setBrain(ws, id, body);
  }

  @Get("campaigns/:id/budget")
  budget(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.brain.budgetUsage(ws, id);
  }

  @Post("conversations/:id/draft/approve")
  approve(
    @WorkspaceId() ws: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approveSchema)) body: ApproveDto,
  ) {
    return this.brain.approve(ws, id, body);
  }

  @Post("conversations/:id/draft/discard")
  discard(@WorkspaceId() ws: string, @Param("id") id: string) {
    return this.brain.discard(ws, id);
  }
}

@Module({ controllers: [BrainController], providers: [BrainService] })
export class BrainModule {}
