"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace/context";

// Roles match packages/core's RBAC matrix. The server is the source of truth;
// these client checks only hide/disable controls the role can't use.
type Role = "owner" | "admin" | "member";

interface MemberView {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
  joinedAt: string;
}
interface InviteView {
  id: string;
  email: string;
  role: Role;
  status: string;
  createdAt: string;
}
interface MembersResponse {
  currentUserRole: Role;
  members: MemberView[];
  invites: InviteView[];
}

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        role === "owner"
          ? "bg-primary/10 text-primary"
          : role === "admin"
            ? "bg-accent text-accent-foreground"
            : "bg-muted text-muted-foreground",
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

export function MembersClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();

  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberView | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<MembersResponse>(`/workspaces/${activeWorkspaceId}/members`);
      setData(res);
    } catch (err) {
      setError(errorMessage(err, "Could not load members"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const role = data?.currentUserRole ?? "member";
  const canManage = role === "owner" || role === "admin";
  const canManageOwners = role === "owner";

  const changeRole = async (member: MemberView, newRole: Role): Promise<void> => {
    if (!activeWorkspaceId || newRole === member.role) {
      return;
    }
    setActionError(null);
    try {
      await api.request(`/workspaces/${activeWorkspaceId}/members/${member.userId}`, {
        method: "PATCH",
        body: { role: newRole },
      });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not change role"));
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!activeWorkspaceId || !removeTarget) {
      return;
    }
    setRemoving(true);
    setActionError(null);
    try {
      await api.request(`/workspaces/${activeWorkspaceId}/members/${removeTarget.userId}`, {
        method: "DELETE",
      });
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not remove member"));
    } finally {
      setRemoving(false);
    }
  };

  const revokeInvite = async (invite: InviteView): Promise<void> => {
    if (!activeWorkspaceId) {
      return;
    }
    setActionError(null);
    try {
      await api.request(`/workspaces/${activeWorkspaceId}/invites/${invite.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not revoke invite"));
    }
  };

  if (!activeWorkspaceId) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a workspace to manage its members.
      </p>
    );
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading members…</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return null;
  }

  // An owner row is only editable by another owner; the last owner can't be
  // demoted/removed (server-enforced — we surface the error if attempted).
  const roleOptions = (member: MemberView): Role[] => {
    const base: Role[] = canManageOwners ? ["owner", "admin", "member"] : ["admin", "member"];
    return base.includes(member.role) ? base : [member.role, ...base];
  };
  const canEditMember = (member: MemberView): boolean =>
    canManage && (member.role !== "owner" || canManageOwners);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.members.length} member{data.members.length === 1 ? "" : "s"}
        </p>
        {canManage ? (
          <Button onClick={() => setInviteOpen(true)}>
            <Plus />
            Invite member
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {/* Members */}
      <div className="divide-y rounded-lg border">
        {data.members.map((member) => (
          <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase">
              {(member.name ?? member.email ?? "?").charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{member.name ?? member.email}</div>
              {member.name ? (
                <div className="truncate text-xs text-muted-foreground">{member.email}</div>
              ) : null}
            </div>

            {canEditMember(member) ? (
              <select
                value={member.role}
                onChange={(e) => void changeRole(member, e.target.value as Role)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {roleOptions(member).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            ) : (
              <RoleBadge role={member.role} />
            )}

            {canEditMember(member) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Member actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setRemoveTarget(member)}
                  >
                    Remove from workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="w-9" />
            )}
          </div>
        ))}
      </div>

      {/* Pending invites */}
      {data.invites.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pending invites
          </h2>
          <div className="divide-y rounded-lg border">
            {data.invites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 truncate text-sm">{invite.email}</div>
                <RoleBadge role={invite.role} />
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Pending
                </span>
                {canManage ? (
                  <Button variant="ghost" size="sm" onClick={() => void revokeInvite(invite)}>
                    Revoke
                  </Button>
                ) : (
                  <span className="w-9" />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <InviteMemberModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          canGrantOwner={canManageOwners}
          onInvited={load}
          invite={async (email, inviteRole) => {
            await api.request(`/workspaces/${activeWorkspaceId}/members`, {
              method: "POST",
              body: { email, role: inviteRole },
            });
          }}
        />
      ) : null}

      <Modal
        open={removeTarget !== null}
        onClose={() => (removing ? undefined : setRemoveTarget(null))}
        title="Remove member"
        description={`Remove ${removeTarget?.name ?? removeTarget?.email ?? "this member"} from the workspace? They lose access immediately.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void confirmRemove()} disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function InviteMemberModal({
  open,
  onClose,
  canGrantOwner,
  invite,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  canGrantOwner: boolean;
  invite: (email: string, role: Role) => Promise<void>;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setEmail("");
    setRole("member");
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await invite(email.trim(), role);
      await onInvited();
      close();
    } catch (err) {
      setError(errorMessage(err, "Could not send invite"));
      setSubmitting(false);
    }
  };

  const roleChoices: Role[] = canGrantOwner ? ["member", "admin", "owner"] : ["member", "admin"];

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite member"
      description="They join immediately if they already have an account, otherwise they're added when they sign up with this email."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {roleChoices.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!email.trim() || submitting}>
            {submitting ? "Inviting…" : "Send invite"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
