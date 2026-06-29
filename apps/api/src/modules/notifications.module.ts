import type { DB } from "@10xconnect/db";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { KYSELY_DB } from "../database/database.module";

// In-app notifications (CLAUDE.md §2/§6). The restriction domain event is written
// here by flagAccountIncident (packages/engine/src/restrictions.ts) when an account
// is auto-paused/restricted — this module is the read+dismiss surface that makes
// those account pauses visible to the user in the FE.

const NOTIFICATION_VIEW_COLUMNS = [
  "id",
  "type",
  "title",
  "body",
  "account_id",
  "read",
  "created_at",
] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  account_id: string | null;
  read: boolean;
  created_at: string;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /** Most-recent-first notifications for the workspace; optionally unread-only. */
  async list(workspaceId: string, opts: { unreadOnly: boolean; limit: number }): Promise<NotificationView[]> {
    let q = this.db
      .selectFrom("notifications")
      .where("workspace_id", "=", workspaceId)
      .select(NOTIFICATION_VIEW_COLUMNS);
    if (opts.unreadOnly) {
      q = q.where("read", "=", false);
    }
    const rows = await q
      .orderBy("created_at", "desc")
      .limit(Math.min(Math.max(1, opts.limit), MAX_LIMIT))
      .execute();
    return rows.map(toView);
  }

  /** Count of unread notifications — drives a badge/bell in the FE. */
  async unreadCount(workspaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom("notifications")
      .where("workspace_id", "=", workspaceId)
      .where("read", "=", false)
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Mark a single notification read (idempotent; scoped to the workspace). */
  async markRead(workspaceId: string, id: string): Promise<{ ok: true }> {
    await this.db
      .updateTable("notifications")
      .set({ read: true })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .execute();
    return { ok: true };
  }

  /** Mark every notification in the workspace read. Returns how many changed. */
  async markAllRead(workspaceId: string): Promise<{ updated: number }> {
    const res = await this.db
      .updateTable("notifications")
      .set({ read: true })
      .where("workspace_id", "=", workspaceId)
      .where("read", "=", false)
      .executeTakeFirst();
    return { updated: Number(res.numUpdatedRows ?? 0n) };
  }
}

function toView(row: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  account_id: string | null;
  read: boolean;
  created_at: string;
}): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    account_id: row.account_id,
    read: row.read,
    created_at: row.created_at,
  };
}

@UseGuards(WorkspaceScopeGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @WorkspaceId() workspaceId: string,
    @Query("unread") unread?: string,
    @Query("limit") limit?: string,
  ): Promise<NotificationView[]> {
    return this.notifications.list(workspaceId, {
      unreadOnly: unread === "true" || unread === "1",
      limit: limit ? Number(limit) || DEFAULT_LIMIT : DEFAULT_LIMIT,
    });
  }

  @Get("unread-count")
  unreadCount(@WorkspaceId() workspaceId: string): Promise<{ count: number }> {
    return this.notifications.unreadCount(workspaceId).then((count) => ({ count }));
  }

  @Post("read-all")
  markAllRead(@WorkspaceId() workspaceId: string): Promise<{ updated: number }> {
    return this.notifications.markAllRead(workspaceId);
  }

  @Post(":id/read")
  markRead(
    @WorkspaceId() workspaceId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ ok: true }> {
    return this.notifications.markRead(workspaceId, id);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
