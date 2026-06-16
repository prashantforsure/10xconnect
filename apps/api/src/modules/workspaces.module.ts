import type { DB, Enums } from "@10xconnect/db";
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// Cross-workspace management surface — auth-only (no WorkspaceScopeGuard).
// Membership for :id routes is resolved inside the service. Granular RBAC
// (Owner/Admin/Member permissions) arrives in Step 6; for now any member may
// rename/update/delete a workspace they belong to.

const INBOX_TYPES = ["not_configured", "all_conversations", "campaign_only"] as const;

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});
type CreateWorkspaceDto = z.infer<typeof createWorkspaceSchema>;

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    settings: z
      .object({
        inbox_type: z.enum(INBOX_TYPES).optional(),
        auto_withdraw_days: z.number().int().min(1).max(90).optional(),
      })
      .optional(),
    branding: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.settings !== undefined || v.branding !== undefined, {
    message: "No fields to update",
  });
type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;

interface WorkspaceSettings {
  inbox_type: (typeof INBOX_TYPES)[number];
  auto_withdraw_days: number;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  inbox_type: "not_configured",
  auto_withdraw_days: 14,
};

type MembershipRole = Enums<"membership_role">;

export interface WorkspaceView {
  id: string;
  name: string;
  owner_id: string;
  role: MembershipRole;
  settings: WorkspaceSettings;
  branding: Record<string, unknown>;
  created_at: string;
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /** Workspaces the user is a member of, with their role, oldest first. */
  async list(userId: string): Promise<WorkspaceView[]> {
    const rows = await this.db
      .selectFrom("workspaces")
      .innerJoin("memberships", "memberships.workspace_id", "workspaces.id")
      .where("memberships.user_id", "=", userId)
      .select([
        "workspaces.id as id",
        "workspaces.name as name",
        "workspaces.owner_id as owner_id",
        "memberships.role as role",
        "workspaces.settings as settings",
        "workspaces.branding as branding",
        "workspaces.created_at as created_at",
      ])
      .orderBy("workspaces.created_at", "asc")
      .execute();

    return rows.map((r) => this.toView(r));
  }

  /**
   * Create a workspace AND the creator's Owner membership atomically. The two
   * inserts share one transaction so a workspace can never exist without an
   * owner (guardrail: never leave a workspace with no owner).
   */
  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceView> {
    return this.db.transaction().execute(async (trx) => {
      const workspace = await trx
        .insertInto("workspaces")
        .values({
          name: dto.name,
          owner_id: userId,
          settings: JSON.stringify(DEFAULT_SETTINGS),
          branding: JSON.stringify({}),
        })
        .returning(["id", "name", "owner_id", "settings", "branding", "created_at"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("memberships")
        .values({ workspace_id: workspace.id, user_id: userId, role: "owner" })
        .execute();

      return this.toView({ ...workspace, role: "owner" });
    });
  }

  async update(userId: string, id: string, dto: UpdateWorkspaceDto): Promise<WorkspaceView> {
    const role = await this.requireMembership(userId, id);

    const current = await this.db
      .selectFrom("workspaces")
      .where("id", "=", id)
      .select(["settings", "branding"])
      .executeTakeFirst();
    if (!current) {
      throw new NotFoundException("Workspace not found");
    }

    const nextSettings = dto.settings
      ? { ...this.parseSettings(current.settings), ...dto.settings }
      : undefined;
    const nextBranding = dto.branding
      ? { ...this.parseBranding(current.branding), ...dto.branding }
      : undefined;

    const updated = await this.db
      .updateTable("workspaces")
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(nextSettings !== undefined ? { settings: JSON.stringify(nextSettings) } : {}),
        ...(nextBranding !== undefined ? { branding: JSON.stringify(nextBranding) } : {}),
      })
      .where("id", "=", id)
      .returning(["id", "name", "owner_id", "settings", "branding", "created_at"])
      .executeTakeFirstOrThrow();

    return this.toView({ ...updated, role });
  }

  /** Delete the workspace; FK ON DELETE CASCADE removes all scoped rows. */
  async remove(userId: string, id: string): Promise<{ deleted: true; id: string }> {
    await this.requireMembership(userId, id);
    await this.db.deleteFrom("workspaces").where("id", "=", id).execute();
    return { deleted: true, id };
  }

  private async requireMembership(userId: string, workspaceId: string): Promise<MembershipRole> {
    const membership = await this.db
      .selectFrom("memberships")
      .select("role")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
    return membership.role;
  }

  private parseSettings(value: unknown): WorkspaceSettings {
    const parsed = this.asObject(value);
    return {
      inbox_type: INBOX_TYPES.includes(parsed.inbox_type as (typeof INBOX_TYPES)[number])
        ? (parsed.inbox_type as WorkspaceSettings["inbox_type"])
        : DEFAULT_SETTINGS.inbox_type,
      auto_withdraw_days:
        typeof parsed.auto_withdraw_days === "number"
          ? parsed.auto_withdraw_days
          : DEFAULT_SETTINGS.auto_withdraw_days,
    };
  }

  private parseBranding(value: unknown): Record<string, unknown> {
    return this.asObject(value);
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toView(row: {
    id: string;
    name: string;
    owner_id: string;
    role: WorkspaceView["role"];
    settings: unknown;
    branding: unknown;
    created_at: string;
  }): WorkspaceView {
    return {
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      role: row.role,
      settings: this.parseSettings(row.settings),
      branding: this.parseBranding(row.branding),
      created_at: row.created_at,
    };
  }
}

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<WorkspaceView[]> {
    return this.workspaces.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceDto,
  ): Promise<WorkspaceView> {
    return this.workspaces.create(user.id, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceDto,
  ): Promise<WorkspaceView> {
    return this.workspaces.update(user.id, id, body);
  }

  @Delete(":id")
  remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.workspaces.remove(user.id, id);
  }

  // --- Members management: Step 6 (RBAC). Stubbed until then. ---
  @Get(":id/members")
  listMembers(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Post(":id/members")
  inviteMember(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }

  @Patch(":id/members/:userId")
  updateMember(@Param("id") _id: string, @Param("userId") _userId: string): never {
    throw new NotImplementedException();
  }

  @Delete(":id/members/:userId")
  removeMember(@Param("id") _id: string, @Param("userId") _userId: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
