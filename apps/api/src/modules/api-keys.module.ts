import { randomBytes } from "node:crypto";

import type { ApiKeyPermission, DB } from "@10xconnect/db";
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
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { API_KEY_TOKEN_PREFIX, hashApiKey } from "../auth/api-key-auth.service";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  permission: z.enum(["all", "read_only"]).optional(),
});
type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

const renameApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
type RenameApiKeyDto = z.infer<typeof renameApiKeySchema>;

/** Display prefix stored alongside the hash (e.g. "10xc_a1b2c3d"). */
const PREFIX_DISPLAY_LENGTH = 12;

@Injectable()
export class ApiKeysService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async list(workspaceId: string) {
    return this.db
      .selectFrom("api_keys")
      .select([
        "id",
        "name",
        "permission",
        "prefix",
        "last_used_at as lastUsedAt",
        "created_at as createdAt",
      ])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }

  /** Generate a key, store only its hash, and return the plaintext ONCE. */
  async create(
    workspaceId: string,
    input: CreateApiKeyDto,
  ): Promise<{
    id: string;
    key: string;
    name: string;
    permission: ApiKeyPermission;
    createdAt: string;
  }> {
    const key = `${API_KEY_TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
    const name = input.name ?? "Default";
    const permission = input.permission ?? "all";
    const row = await this.db
      .insertInto("api_keys")
      .values({
        workspace_id: workspaceId,
        hash: hashApiKey(key),
        name,
        permission,
        prefix: key.slice(0, PREFIX_DISPLAY_LENGTH),
      })
      .returning(["id", "created_at as createdAt"])
      .executeTakeFirstOrThrow();
    return { id: row.id, key, name, permission, createdAt: row.createdAt };
  }

  async rename(workspaceId: string, id: string, name: string): Promise<{ id: string; name: string }> {
    const updated = await this.db
      .updateTable("api_keys")
      .set({ name })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(["id", "name"])
      .executeTakeFirst();
    if (!updated) {
      throw new NotFoundException("API key not found");
    }
    return updated;
  }

  async remove(workspaceId: string, id: string): Promise<{ revoked: true }> {
    const deleted = await this.db
      .deleteFrom("api_keys")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("API key not found");
    }
    return { revoked: true };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string) {
    return this.apiKeys.list(workspaceId);
  }

  @Post()
  create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(workspaceId, body ?? {});
  }

  @Patch(":id")
  rename(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renameApiKeySchema)) body: RenameApiKeyDto,
  ) {
    return this.apiKeys.rename(workspaceId, id, body.name);
  }

  @Delete(":id")
  remove(@WorkspaceId() workspaceId: string, @Param("id") id: string) {
    return this.apiKeys.remove(workspaceId, id);
  }
}

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
