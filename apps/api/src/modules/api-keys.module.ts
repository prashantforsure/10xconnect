import { createHash, randomBytes } from "node:crypto";

import type { DB } from "@10xconnect/db";
import {
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { KYSELY_DB } from "../database/database.module";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async list(workspaceId: string) {
    return this.db
      .selectFrom("api_keys")
      .select(["id", "created_at as createdAt"])
      .where("workspace_id", "=", workspaceId)
      .orderBy("created_at", "desc")
      .execute();
  }

  /** Generate a key, store only its hash, and return the plaintext ONCE. */
  async create(workspaceId: string): Promise<{ id: string; key: string; createdAt: string }> {
    const key = `10xc_${randomBytes(24).toString("hex")}`;
    const row = await this.db
      .insertInto("api_keys")
      .values({ workspace_id: workspaceId, hash: hashKey(key) })
      .returning(["id", "created_at as createdAt"])
      .executeTakeFirstOrThrow();
    return { id: row.id, key, createdAt: row.createdAt };
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
  create(@WorkspaceId() workspaceId: string) {
    return this.apiKeys.create(workspaceId);
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
