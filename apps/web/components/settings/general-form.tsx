"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace/constants";
import { useWorkspace } from "@/lib/workspace/context";

interface ProfileInput {
  firstName: string;
  lastName: string;
  email: string;
}

interface WorkspaceInput {
  id: string;
  name: string;
  inboxType: string;
  autoWithdrawDays: number;
}

const INBOX_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "not_configured", label: "Not configured" },
  { value: "all_conversations", label: "All conversations" },
  { value: "campaign_only", label: "Campaign conversations only" },
];

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function GeneralSettingsForm({
  profile,
  workspace,
}: {
  profile: ProfileInput;
  workspace: WorkspaceInput | null;
}) {
  const api = useApi();
  const router = useRouter();
  const { workspaces, setActiveWorkspaceId } = useWorkspace();

  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [wsName, setWsName] = useState(workspace?.name ?? "");
  const [inboxType, setInboxType] = useState(workspace?.inboxType ?? "not_configured");
  const [autoWithdrawDays, setAutoWithdrawDays] = useState(workspace?.autoWithdrawDays ?? 14);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const saveDisabled = saving || (workspace !== null && wsName.trim().length === 0);

  const onSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (saveDisabled) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Profile lives on the user's own row — written via Supabase + RLS.
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { error } = await supabase
          .from("profiles")
          .update({
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
            name: fullName || null,
          })
          .eq("id", user.id);
        if (error) {
          throw new Error(error.message);
        }
      }

      // Workspace name + settings go through the API (server-validated, clamped).
      if (workspace) {
        await api.request(`/workspaces/${workspace.id}`, {
          method: "PATCH",
          body: {
            name: wsName.trim(),
            settings: { inbox_type: inboxType, auto_withdraw_days: autoWithdrawDays },
          },
        });
      }

      setSaved(true);
      router.refresh();
    } catch (err) {
      setSaveError(errorMessage(err, "Could not save changes"));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!workspace || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.request(`/workspaces/${workspace.id}`, { method: "DELETE" });
      const remaining = workspaces.filter((w) => w.id !== workspace.id);
      if (remaining[0]) {
        setActiveWorkspaceId(remaining[0].id); // persists cookie + refreshes
      } else {
        document.cookie = `${ACTIVE_WORKSPACE_COOKIE}=; path=/; max-age=0; samesite=lax`;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setDeleteError(errorMessage(err, "Could not delete workspace"));
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-10">
      <form onSubmit={onSave} className="space-y-8">
        {/* Profile */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Profile
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last-name">Last name</Label>
              <Input
                id="last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={profile.email} disabled readOnly />
            <p className="text-xs text-muted-foreground">Your sign-in email can’t be changed here.</p>
          </div>
        </section>

        {/* Workspace */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace
          </h2>
          {workspace ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input
                  id="workspace-name"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inbox-type">Inbox type</Label>
                <select
                  id="inbox-type"
                  value={inboxType}
                  onChange={(e) => setInboxType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {INBOX_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Which conversations the unified inbox pulls in. Applied later.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="auto-withdraw">Auto-withdraw connection requests after (days)</Label>
                <Input
                  id="auto-withdraw"
                  type="number"
                  min={1}
                  max={90}
                  value={autoWithdrawDays}
                  onChange={(e) =>
                    setAutoWithdrawDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))
                  }
                  className="max-w-32"
                />
                <p className="text-xs text-muted-foreground">
                  Pending invites older than this are withdrawn automatically. Default 14.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Create a workspace from the switcher to edit its settings.
            </p>
          )}
        </section>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saveDisabled}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
          {saveError ? <span className="text-sm text-destructive">{saveError}</span> : null}
        </div>
      </form>

      {/* Danger zone */}
      {workspace ? (
        <section className="space-y-3 rounded-lg border border-destructive/30 p-5">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="text-sm text-muted-foreground">
            Deleting this workspace permanently removes its accounts, campaigns, contacts, and
            conversations. This cannot be undone.
          </p>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete workspace
          </Button>
        </section>
      ) : null}

      <Modal
        open={deleteOpen}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        title="Delete workspace"
        description={`Type “${workspace?.name ?? ""}” to confirm. This permanently deletes the workspace and all its data.`}
      >
        <div className="space-y-4">
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={workspace?.name ?? ""}
            autoFocus
          />
          {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={deleting || deleteConfirm.trim() !== (workspace?.name ?? "")}
            >
              {deleting ? "Deleting…" : "Delete workspace"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
