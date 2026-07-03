import { type Role, can } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { resolveSimulation } from "@10xconnect/engine";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
import { type Kysely, sql } from "kysely";
import { z } from "zod";

import type { AuthUser } from "../auth/auth-user.interface";
import { CurrentUser } from "../auth/current-user.decorator";
import { MemberRole } from "../common/decorators/member-role.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WorkspaceRbacGuard } from "../common/guards/workspace-rbac.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// Cross-workspace management surface — auth-only globally; the :id routes use
// WorkspaceRbacGuard, which resolves the caller's role from the :id param and
// enforces @RequirePermission. list/create take no :id and need no role.

const INBOX_TYPES = ["not_configured", "all_conversations", "campaign_only"] as const;
const ROLE_VALUES = ["owner", "admin", "member"] as const;

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
        // Per-workspace test/simulation mode: run the full pipeline but send nothing
        // real (safe production testing). Explicit here; unset → developer default.
        simulation_mode: z.boolean().optional(),
      })
      .optional(),
    branding: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.settings !== undefined || v.branding !== undefined, {
    message: "No fields to update",
  });
type UpdateWorkspaceDto = z.infer<typeof updateWorkspaceSchema>;

const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(ROLE_VALUES).default("member"),
});
type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

const updateMemberRoleSchema = z.object({ role: z.enum(ROLE_VALUES) });
type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;

interface WorkspaceSettings {
  inbox_type: (typeof INBOX_TYPES)[number];
  auto_withdraw_days: number;
  /**
   * Test/simulation mode toggle. Explicit boolean when the user has set it; left
   * UNSET (undefined) so the developer-owner default applies (see effectiveSimulation).
   */
  simulation_mode?: boolean;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  inbox_type: "not_configured",
  auto_withdraw_days: 14,
};

export interface WorkspaceView {
  id: string;
  name: string;
  owner_id: string;
  role: Role;
  settings: WorkspaceSettings;
  branding: Record<string, unknown>;
  created_at: string;
  /**
   * Resolved test/simulation state (explicit setting, else developer-owner default).
   * The UI toggle + "Simulation mode" banner read this so they reflect reality even
   * when simulation_mode is unset.
   */
  effectiveSimulation: boolean;
}

export interface MemberView {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
  joinedAt: string;
}

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
}

export interface MembersResponse {
  currentUserRole: Role;
  members: MemberView[];
  invites: InviteView[];
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /** Workspaces the user is a member of, with their role, oldest first. */
  async list(userId: string): Promise<WorkspaceView[]> {
    const rows = await this.db
      .selectFrom("workspaces")
      .innerJoin("memberships", "memberships.workspace_id", "workspaces.id")
      // Owner email drives the developer-default of simulation mode (effectiveSimulation).
      .leftJoin("profiles", "profiles.id", "workspaces.owner_id")
      .where("memberships.user_id", "=", userId)
      .select([
        "workspaces.id as id",
        "workspaces.name as name",
        "workspaces.owner_id as owner_id",
        "memberships.role as role",
        "workspaces.settings as settings",
        "workspaces.branding as branding",
        "workspaces.created_at as created_at",
        "profiles.email as ownerEmail",
      ])
      .orderBy("workspaces.created_at", "asc")
      .execute();

    return rows.map((r) => this.toView(r, r.ownerEmail));
  }

  /**
   * Create a workspace AND the creator's Owner membership atomically, so a
   * workspace can never exist without an owner.
   */
  async create(userId: string, dto: CreateWorkspaceDto, ownerEmail?: string | null): Promise<WorkspaceView> {
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

      // Pass the creator's email so a developer's new workspace reflects its
      // default simulation state immediately (settings carry no explicit choice yet).
      return this.toView({ ...workspace, role: "owner" }, ownerEmail);
    });
  }

  /** Update name + merge settings/branding. Access enforced by the RBAC guard. */
  async update(
    workspaceId: string,
    dto: UpdateWorkspaceDto,
    actorRole: Role,
  ): Promise<WorkspaceView> {
    const current = await this.db
      .selectFrom("workspaces")
      .leftJoin("profiles", "profiles.id", "workspaces.owner_id")
      .where("workspaces.id", "=", workspaceId)
      .select([
        "workspaces.settings as settings",
        "workspaces.branding as branding",
        "profiles.email as ownerEmail",
      ])
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
      .where("id", "=", workspaceId)
      .returning(["id", "name", "owner_id", "settings", "branding", "created_at"])
      .executeTakeFirstOrThrow();

    return this.toView({ ...updated, role: actorRole }, current.ownerEmail);
  }

  /** Delete the workspace; FK ON DELETE CASCADE removes all scoped rows. */
  async remove(workspaceId: string): Promise<{ deleted: true; id: string }> {
    await this.db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
    return { deleted: true, id: workspaceId };
  }

  // --- members ---------------------------------------------------------------

  async listMembers(workspaceId: string, actorRole: Role): Promise<MembersResponse> {
    const memberRows = await this.db
      .selectFrom("memberships")
      .innerJoin("profiles", "profiles.id", "memberships.user_id")
      .where("memberships.workspace_id", "=", workspaceId)
      .select([
        "memberships.user_id as userId",
        "memberships.role as role",
        "memberships.created_at as joinedAt",
        "profiles.email as email",
        "profiles.name as name",
        "profiles.first_name as firstName",
        "profiles.last_name as lastName",
      ])
      .orderBy("memberships.created_at", "asc")
      .execute();

    const inviteRows = await this.db
      .selectFrom("workspace_invites")
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", "pending")
      .select(["id", "email", "role", "status", "created_at as createdAt"])
      .orderBy("created_at", "asc")
      .execute();

    return {
      currentUserRole: actorRole,
      members: memberRows.map((m) => ({
        userId: m.userId,
        name: this.displayName(m.firstName, m.lastName, m.name),
        email: m.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      invites: inviteRows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        createdAt: i.createdAt,
      })),
    };
  }

  /**
   * Invite by email. If a profile already exists → add the membership now;
   * otherwise store a pending invite (resolved by handle_new_user on signup).
   */
  async invite(
    workspaceId: string,
    actorId: string,
    actorRole: Role,
    dto: InviteMemberDto,
  ): Promise<{ type: "member"; member: MemberView } | { type: "invite"; invite: InviteView }> {
    if (dto.role === "owner" && !can(actorRole, "workspace:transfer_ownership")) {
      throw new ForbiddenException("Only an owner can invite another owner");
    }
    const email = dto.email.toLowerCase();

    const profile = await this.db
      .selectFrom("profiles")
      .select(["id", "email", "name", "first_name as firstName", "last_name as lastName"])
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst();

    if (profile) {
      const existing = await this.db
        .selectFrom("memberships")
        .select("user_id")
        .where("workspace_id", "=", workspaceId)
        .where("user_id", "=", profile.id)
        .executeTakeFirst();
      if (existing) {
        throw new ConflictException("That person is already a member of this workspace");
      }

      const inserted = await this.db
        .insertInto("memberships")
        .values({ workspace_id: workspaceId, user_id: profile.id, role: dto.role })
        .returning(["user_id as userId", "role", "created_at as joinedAt"])
        .executeTakeFirstOrThrow();

      return {
        type: "member",
        member: {
          userId: inserted.userId,
          name: this.displayName(profile.firstName, profile.lastName, profile.name),
          email: profile.email,
          role: inserted.role,
          joinedAt: inserted.joinedAt,
        },
      };
    }

    const existingInvite = await this.db
      .selectFrom("workspace_invites")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where(sql<boolean>`lower(email) = ${email}`)
      .where("status", "=", "pending")
      .executeTakeFirst();
    if (existingInvite) {
      throw new ConflictException("An invite is already pending for that email");
    }

    const invite = await this.db
      .insertInto("workspace_invites")
      .values({ workspace_id: workspaceId, email, role: dto.role, invited_by: actorId })
      .returning(["id", "email", "role", "status", "created_at as createdAt"])
      .executeTakeFirstOrThrow();

    return {
      type: "invite",
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        createdAt: invite.createdAt,
      },
    };
  }

  async updateMemberRole(
    workspaceId: string,
    actorRole: Role,
    targetUserId: string,
    newRole: Role,
  ): Promise<MemberView> {
    const target = await this.db
      .selectFrom("memberships")
      .select("role")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", targetUserId)
      .executeTakeFirst();
    if (!target) {
      throw new NotFoundException("Member not found");
    }

    // Granting OR changing the owner role is an ownership transfer (Owner only).
    if (
      (newRole === "owner" || target.role === "owner") &&
      !can(actorRole, "workspace:transfer_ownership")
    ) {
      throw new ForbiddenException("Only an owner can assign or change the owner role");
    }

    if (target.role === "owner" && newRole !== "owner" && (await this.countOwners(workspaceId)) <= 1) {
      throw new BadRequestException("Cannot demote the last owner of the workspace");
    }

    await this.db
      .updateTable("memberships")
      .set({ role: newRole })
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", targetUserId)
      .execute();

    return this.getMember(workspaceId, targetUserId);
  }

  async removeMember(
    workspaceId: string,
    actorRole: Role,
    targetUserId: string,
  ): Promise<{ removed: true; userId: string }> {
    const target = await this.db
      .selectFrom("memberships")
      .select("role")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", targetUserId)
      .executeTakeFirst();
    if (!target) {
      throw new NotFoundException("Member not found");
    }

    if (target.role === "owner" && !can(actorRole, "workspace:transfer_ownership")) {
      throw new ForbiddenException("Only an owner can remove an owner");
    }
    if (target.role === "owner" && (await this.countOwners(workspaceId)) <= 1) {
      throw new BadRequestException("Cannot remove the last owner of the workspace");
    }

    await this.db
      .deleteFrom("memberships")
      .where("workspace_id", "=", workspaceId)
      .where("user_id", "=", targetUserId)
      .execute();

    return { removed: true, userId: targetUserId };
  }

  async revokeInvite(
    workspaceId: string,
    inviteId: string,
  ): Promise<{ revoked: true; id: string }> {
    const deleted = await this.db
      .deleteFrom("workspace_invites")
      .where("id", "=", inviteId)
      .where("workspace_id", "=", workspaceId)
      .where("status", "=", "pending")
      .returning("id")
      .executeTakeFirst();
    if (!deleted) {
      throw new NotFoundException("Pending invite not found");
    }
    return { revoked: true, id: inviteId };
  }

  private async getMember(workspaceId: string, userId: string): Promise<MemberView> {
    const row = await this.db
      .selectFrom("memberships")
      .innerJoin("profiles", "profiles.id", "memberships.user_id")
      .where("memberships.workspace_id", "=", workspaceId)
      .where("memberships.user_id", "=", userId)
      .select([
        "memberships.user_id as userId",
        "memberships.role as role",
        "memberships.created_at as joinedAt",
        "profiles.email as email",
        "profiles.name as name",
        "profiles.first_name as firstName",
        "profiles.last_name as lastName",
      ])
      .executeTakeFirstOrThrow();
    return {
      userId: row.userId,
      name: this.displayName(row.firstName, row.lastName, row.name),
      email: row.email,
      role: row.role,
      joinedAt: row.joinedAt,
    };
  }

  private async countOwners(workspaceId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom("memberships")
      .where("workspace_id", "=", workspaceId)
      .where("role", "=", "owner")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  private displayName(
    first: string | null,
    last: string | null,
    name: string | null,
  ): string | null {
    const combined = [first, last].filter(Boolean).join(" ").trim();
    return combined || name || null;
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
      // Preserve boolean | undefined — undefined means "no explicit choice" so the
      // developer-owner default decides (see resolveSimulation).
      ...(typeof parsed.simulation_mode === "boolean" ? { simulation_mode: parsed.simulation_mode } : {}),
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

  private toView(
    row: {
      id: string;
      name: string;
      owner_id: string;
      role: Role;
      settings: unknown;
      branding: unknown;
      created_at: string;
    },
    ownerEmail?: string | null,
  ): WorkspaceView {
    const settings = this.parseSettings(row.settings);
    return {
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      role: row.role,
      settings,
      branding: this.parseBranding(row.branding),
      created_at: row.created_at,
      // Explicit setting wins; otherwise a developer-owned workspace defaults to on.
      effectiveSimulation: resolveSimulation(settings, ownerEmail ?? null),
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
    return this.workspaces.create(user.id, body, user.email ?? null);
  }

  @Patch(":id")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("workspace:update")
  update(
    @WorkspaceId() workspaceId: string,
    @MemberRole() role: Role,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceDto,
  ): Promise<WorkspaceView> {
    return this.workspaces.update(workspaceId, body, role);
  }

  @Delete(":id")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("workspace:delete")
  remove(@WorkspaceId() workspaceId: string): Promise<{ deleted: true; id: string }> {
    return this.workspaces.remove(workspaceId);
  }

  @Get(":id/members")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("members:read")
  listMembers(@WorkspaceId() workspaceId: string, @MemberRole() role: Role): Promise<MembersResponse> {
    return this.workspaces.listMembers(workspaceId, role);
  }

  @Post(":id/members")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("members:invite")
  inviteMember(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @MemberRole() role: Role,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberDto,
  ): Promise<{ type: "member"; member: MemberView } | { type: "invite"; invite: InviteView }> {
    return this.workspaces.invite(workspaceId, user.id, role, body);
  }

  @Patch(":id/members/:userId")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("members:update_role")
  updateMember(
    @WorkspaceId() workspaceId: string,
    @MemberRole() role: Role,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) body: UpdateMemberRoleDto,
  ): Promise<MemberView> {
    return this.workspaces.updateMemberRole(workspaceId, role, userId, body.role);
  }

  @Delete(":id/members/:userId")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("members:remove")
  removeMember(
    @WorkspaceId() workspaceId: string,
    @MemberRole() role: Role,
    @Param("userId") userId: string,
  ): Promise<{ removed: true; userId: string }> {
    return this.workspaces.removeMember(workspaceId, role, userId);
  }

  @Delete(":id/invites/:inviteId")
  @UseGuards(WorkspaceRbacGuard)
  @RequirePermission("members:invite")
  revokeInvite(
    @WorkspaceId() workspaceId: string,
    @Param("inviteId") inviteId: string,
  ): Promise<{ revoked: true; id: string }> {
    return this.workspaces.revokeInvite(workspaceId, inviteId);
  }
}

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
