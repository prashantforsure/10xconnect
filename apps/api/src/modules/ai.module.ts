import { createTextAdapter } from "@10xconnect/adapters";
import {
  buildPersonalizationPrompt,
  COMMUNITY_PROMPTS,
  type MessageBody,
  type PersonalizationProfile,
  type PromptCard,
  renderMessageBody,
  varietyWarning,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { leadVariables, profileFromLead } from "@10xconnect/engine";
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
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

const createPromptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.string().trim().min(1).max(4000),
});
type CreatePromptDto = z.infer<typeof createPromptSchema>;

const favoriteSchema = z.object({
  ref: z.string().trim().min(1).max(120),
  favorited: z.boolean(),
});
type FavoriteDto = z.infer<typeof favoriteSchema>;

const segmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("variable"), key: z.string(), fallback: z.string().optional() }),
  z.object({ type: z.literal("ai"), prompt: z.string().optional(), promptId: z.string().optional() }),
]);
const renderPreviewSchema = z.object({
  segments: z.array(segmentSchema).max(100),
  leadIds: z.array(z.string().uuid()).max(10).optional(),
  sampleSize: z.number().int().min(1).max(8).optional(),
});
type RenderPreviewDto = z.infer<typeof renderPreviewSchema>;

interface RenderResult {
  leadId: string;
  name: string;
  text: string;
}

const LEAD_COLS = [
  "id",
  "workspace_id",
  "linkedin_url",
  "email",
  "enrichment",
  "tags",
  "custom_columns",
  "connection_degree",
] as const;

function leadName(profile: PersonalizationProfile, fallback: string): string {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || fallback || "Lead";
}

@Injectable()
export class AiService {
  private readonly text = createTextAdapter();

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  isConfigured(): boolean {
    return this.text !== null;
  }

  // --- Prompt library ------------------------------------------------------

  async library(
    workspaceId: string,
    userId: string,
  ): Promise<{ community: PromptCard[]; saved: PromptCard[]; mine: PromptCard[] }> {
    const favRows = await this.db
      .selectFrom("ai_prompt_favorites")
      .select("prompt_ref")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", userId)
      .execute();
    const favs = new Set(favRows.map((r) => r.prompt_ref));

    const rows = await this.db
      .selectFrom("ai_prompts as p")
      .leftJoin("profiles as pr", "pr.id", "p.created_by")
      .select([
        "p.id as id",
        "p.name as name",
        "p.template as template",
        "p.run_count as runCount",
        "pr.name as authorName",
      ])
      .where("p.workspace_id", "=", workspaceId)
      .orderBy("p.created_at", "desc")
      .execute();

    const mine: PromptCard[] = rows.map((r) => {
      const ref = `workspace:${r.id}`;
      return {
        ref,
        title: r.name,
        template: r.template,
        author: r.authorName ?? "Workspace",
        runCount: Number(r.runCount ?? 0),
        favorited: favs.has(ref),
      };
    });

    const community: PromptCard[] = COMMUNITY_PROMPTS.map((c) => ({
      ...c,
      favorited: favs.has(c.ref),
    }));

    const byRef = new Map<string, PromptCard>();
    for (const c of [...community, ...mine]) {
      byRef.set(c.ref, c);
    }
    const saved: PromptCard[] = [...favs]
      .map((ref) => byRef.get(ref))
      .filter((c): c is PromptCard => Boolean(c))
      .map((c) => ({ ...c, favorited: true }));

    return { community, saved, mine };
  }

  async createPrompt(workspaceId: string, userId: string, dto: CreatePromptDto): Promise<PromptCard> {
    const row = await this.db
      .insertInto("ai_prompts")
      .values({
        workspace_id: workspaceId,
        name: dto.name,
        template: dto.template,
        created_by: userId,
      })
      .returning(["id", "name", "template", "run_count as runCount"])
      .executeTakeFirstOrThrow();
    return {
      ref: `workspace:${row.id}`,
      title: row.name,
      template: row.template,
      author: "You",
      runCount: Number(row.runCount ?? 0),
      favorited: false,
    };
  }

  async toggleFavorite(workspaceId: string, userId: string, dto: FavoriteDto): Promise<{ favorited: boolean }> {
    if (dto.favorited) {
      await this.db
        .insertInto("ai_prompt_favorites")
        .values({ workspace_id: workspaceId, user_id: userId, prompt_ref: dto.ref })
        .onConflict((oc) => oc.columns(["workspace_id", "user_id", "prompt_ref"]).doNothing())
        .execute();
    } else {
      await this.db
        .deleteFrom("ai_prompt_favorites")
        .where("workspace_id", "=", workspaceId)
        .where("user_id", "=", userId)
        .where("prompt_ref", "=", dto.ref)
        .execute();
    }
    return { favorited: dto.favorited };
  }

  /** Bump the usage counter when a workspace prompt is inserted into a message. */
  async usePrompt(workspaceId: string, ref: string): Promise<{ ok: true }> {
    if (ref.startsWith("workspace:")) {
      const id = ref.slice("workspace:".length);
      await this.db
        .updateTable("ai_prompts")
        .set((eb) => ({ run_count: eb("run_count", "+", 1) }))
        .where("workspace_id", "=", workspaceId)
        .where("id", "=", id)
        .execute();
    }
    return { ok: true };
  }

  // --- Composer render-preview (full message body across sample leads) ------

  async renderPreview(
    workspaceId: string,
    dto: RenderPreviewDto,
  ): Promise<{ results: RenderResult[]; varietyWarning: string | null }> {
    let q = this.db.selectFrom("leads").select(LEAD_COLS).where("workspace_id", "=", workspaceId);
    if (dto.leadIds && dto.leadIds.length > 0) {
      q = q.where("id", "in", dto.leadIds);
    } else {
      q = q.limit(dto.sampleSize ?? 3);
    }
    const leads = await q.execute();
    const body: MessageBody = { v: 1, segments: dto.segments };

    const results: RenderResult[] = [];
    const perPrompt = new Map<string, string[]>();

    for (const row of leads) {
      const lead = {
        id: row.id,
        workspace_id: row.workspace_id,
        linkedin_url: row.linkedin_url,
        email: row.email,
        enrichment: row.enrichment,
        tags: row.tags ?? [],
        custom_columns: row.custom_columns ?? {},
        connection_degree: row.connection_degree,
      };
      const vars = leadVariables(lead);
      const profile = profileFromLead(lead);

      const aiMap = new Map<string, string>();
      for (const seg of dto.segments) {
        if (seg.type === "ai" && seg.prompt && !aiMap.has(seg.prompt)) {
          let out = "";
          if (this.text) {
            try {
              out = await this.text.generate(buildPersonalizationPrompt(seg.prompt, profile));
            } catch {
              out = "";
            }
          }
          aiMap.set(seg.prompt, out);
          const arr = perPrompt.get(seg.prompt) ?? [];
          arr.push(out);
          perPrompt.set(seg.prompt, arr);
        }
      }

      const text = renderMessageBody(body, vars, {
        renderAi: (s) => (s.prompt ? (aiMap.get(s.prompt) ?? "") : ""),
      });
      results.push({ leadId: row.id, name: leadName(profile, row.email ?? row.linkedin_url ?? ""), text });
    }

    let warning: string | null = null;
    for (const outs of perPrompt.values()) {
      warning = varietyWarning(outs);
      if (warning) {
        break;
      }
    }
    return { results, varietyWarning: warning };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("status")
  status(): { configured: boolean } {
    return { configured: this.ai.isConfigured() };
  }

  @Get("library")
  library(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.ai.library(workspaceId, user.id);
  }

  @Post("prompts")
  createPrompt(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPromptSchema)) body: CreatePromptDto,
  ) {
    return this.ai.createPrompt(workspaceId, user.id, body);
  }

  @Post("prompts/favorite")
  favorite(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(favoriteSchema)) body: FavoriteDto,
  ) {
    return this.ai.toggleFavorite(workspaceId, user.id, body);
  }

  @Post("prompts/use")
  use(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(z.object({ ref: z.string().min(1).max(120) }))) body: { ref: string },
  ) {
    return this.ai.usePrompt(workspaceId, body.ref);
  }

  @Post("render-preview")
  renderPreview(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(renderPreviewSchema)) body: RenderPreviewDto,
  ) {
    return this.ai.renderPreview(workspaceId, body);
  }
}

@Module({
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
