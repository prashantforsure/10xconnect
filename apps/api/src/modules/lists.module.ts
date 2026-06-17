import type { DB } from "@10xconnect/db";
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
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

const createListSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  color: z.string().trim().max(20).nullable().optional(),
});
type CreateListDto = z.infer<typeof createListSchema>;

const updateListSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    color: z.string().trim().max(20).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, { message: "No fields to update" });
type UpdateListDto = z.infer<typeof updateListSchema>;

export interface ListView {
  id: string;
  name: string;
  color: string | null;
  leadCount: number;
  createdAt: string;
}

@Injectable()
export class ListsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async list(workspaceId: string): Promise<ListView[]> {
    const rows = await this.db
      .selectFrom("contact_lists")
      .leftJoin("list_leads", "list_leads.list_id", "contact_lists.id")
      .where("contact_lists.workspace_id", "=", workspaceId)
      .select((eb) => [
        "contact_lists.id as id",
        "contact_lists.name as name",
        "contact_lists.color as color",
        "contact_lists.created_at as createdAt",
        eb.fn.count("list_leads.lead_id").as("leadCount"),
      ])
      .groupBy(["contact_lists.id", "contact_lists.name", "contact_lists.color", "contact_lists.created_at"])
      .orderBy("contact_lists.created_at", "asc")
      .execute();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      leadCount: Number(r.leadCount),
      createdAt: r.createdAt,
    }));
  }

  async create(workspaceId: string, dto: CreateListDto): Promise<ListView> {
    const created = await this.db
      .insertInto("contact_lists")
      .values({ workspace_id: workspaceId, name: dto.name, color: dto.color ?? null })
      .returning(["id", "name", "color", "created_at as createdAt"])
      .executeTakeFirstOrThrow();
    return { id: created.id, name: created.name, color: created.color, leadCount: 0, createdAt: created.createdAt };
  }

  async update(workspaceId: string, id: string, dto: UpdateListDto): Promise<ListView> {
    const updated = await this.db
      .updateTable("contact_lists")
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(["id", "name", "color", "created_at as createdAt"])
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("List not found");
    }
    const { count } = await this.db
      .selectFrom("list_leads")
      .where("list_id", "=", id)
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .executeTakeFirstOrThrow();
    return {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      leadCount: Number(count),
      createdAt: updated.createdAt,
    };
  }

  async remove(workspaceId: string, id: string): Promise<{ deleted: true; id: string }> {
    const deleted = await this.db
      .deleteFrom("contact_lists")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("List not found");
    }
    return { deleted: true, id };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("lists")
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string): Promise<ListView[]> {
    return this.lists.list(workspaceId);
  }

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createListSchema)) body: CreateListDto,
  ): Promise<ListView> {
    return this.lists.create(workspaceId, body);
  }

  @Patch(":id")
  update(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateListSchema)) body: UpdateListDto,
  ): Promise<ListView> {
    return this.lists.update(workspaceId, id, body);
  }

  @Delete(":id")
  remove(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.lists.remove(workspaceId, id);
  }
}

@Module({
  controllers: [ListsController],
  providers: [ListsService],
})
export class ListsModule {}
