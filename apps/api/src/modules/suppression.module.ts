import { isLinkedinHttpUrl, normalizeEmail } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
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
  ParseUUIDPipe,
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

// do_not_contact management surface (CLAUDE.md §6/§11). The list itself is already
// enforced at enrollment + send by the engine (packages/engine/src/suppression.ts);
// this exposes the CRUD so users can review + manage who is globally suppressed.

const addSuppressionSchema = z
  .object({
    email: z.string().trim().email().max(255).optional(),
    linkedinUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((u) => isLinkedinHttpUrl(u), { message: "Must be an http(s) linkedin.com URL" })
      .optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email || v.linkedinUrl), {
    message: "Provide an email or a linkedin URL",
  });
type AddSuppressionDto = z.infer<typeof addSuppressionSchema>;

const listSuppressionSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
type ListSuppressionDto = z.infer<typeof listSuppressionSchema>;

export interface SuppressionEntry {
  id: string;
  email: string | null;
  linkedinUrl: string | null;
  reason: string | null;
  createdAt: string;
}

export interface SuppressionListResult {
  entries: SuppressionEntry[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class SuppressionService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async list(workspaceId: string, query: ListSuppressionDto): Promise<SuppressionListResult> {
    let base = this.db.selectFrom("do_not_contact").where("workspace_id", "=", workspaceId);
    if (query.search) {
      const term = `%${query.search}%`;
      base = base.where((eb) =>
        eb.or([eb("email", "ilike", term), eb("linkedin_url", "ilike", term)]),
      );
    }

    const rows = await base
      .select(["id", "email", "linkedin_url as linkedinUrl", "reason", "created_at as createdAt"])
      .orderBy("created_at", "desc")
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    const { total } = await base
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirstOrThrow();

    return {
      entries: rows.map((r) => ({
        id: r.id,
        email: r.email,
        linkedinUrl: r.linkedinUrl,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      total: Number(total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async add(workspaceId: string, userId: string, dto: AddSuppressionDto): Promise<SuppressionEntry> {
    const email = dto.email ? (normalizeEmail(dto.email) ?? dto.email.toLowerCase()) : null;
    const linkedinUrl = dto.linkedinUrl ?? null;
    if (!email && !linkedinUrl) {
      throw new BadRequestException("Provide an email or a linkedin URL");
    }

    const row = await this.db
      .insertInto("do_not_contact")
      .values({
        workspace_id: workspaceId,
        email,
        linkedin_url: linkedinUrl,
        reason: dto.reason ?? "manual",
        created_by: userId,
      })
      // Unique on (workspace, lower(email)) / (workspace, linkedin_url) — a repeat
      // add is a harmless no-op; return the existing row either way.
      .onConflict((oc) => oc.doNothing())
      .returning(["id", "email", "linkedin_url as linkedinUrl", "reason", "created_at as createdAt"])
      .executeTakeFirst();

    if (row) {
      return {
        id: row.id,
        email: row.email,
        linkedinUrl: row.linkedinUrl,
        reason: row.reason,
        createdAt: row.createdAt,
      };
    }

    // Conflict (already suppressed) — fetch and return the existing entry.
    const existing = await this.db
      .selectFrom("do_not_contact")
      .select(["id", "email", "linkedin_url as linkedinUrl", "reason", "created_at as createdAt"])
      .where("workspace_id", "=", workspaceId)
      .where((eb) => {
        const ors = [];
        if (email) ors.push(eb("email", "=", email));
        if (linkedinUrl) ors.push(eb("linkedin_url", "=", linkedinUrl));
        return eb.or(ors);
      })
      .executeTakeFirstOrThrow();
    return {
      id: existing.id,
      email: existing.email,
      linkedinUrl: existing.linkedinUrl,
      reason: existing.reason,
      createdAt: existing.createdAt,
    };
  }

  async remove(workspaceId: string, id: string): Promise<{ deleted: true; id: string }> {
    const deleted = await this.db
      .deleteFrom("do_not_contact")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Suppression entry not found");
    }
    return { deleted: true, id };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("suppression")
export class SuppressionController {
  constructor(private readonly suppression: SuppressionService) {}

  @Get()
  list(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listSuppressionSchema)) query: ListSuppressionDto,
  ): Promise<SuppressionListResult> {
    return this.suppression.list(workspaceId, query);
  }

  @Post()
  add(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addSuppressionSchema)) body: AddSuppressionDto,
  ): Promise<SuppressionEntry> {
    return this.suppression.add(workspaceId, user.id, body);
  }

  @Delete(":id")
  remove(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.suppression.remove(workspaceId, id);
  }
}

@Module({
  controllers: [SuppressionController],
  providers: [SuppressionService],
})
export class SuppressionModule {}
