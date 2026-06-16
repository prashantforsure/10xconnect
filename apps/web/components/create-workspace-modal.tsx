"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

interface CreatedWorkspace {
  id: string;
  name: string;
}

export function CreateWorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const { setActiveWorkspaceId } = useWorkspace();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setName("");
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.request<CreatedWorkspace>("/workspaces", {
        method: "POST",
        body: { name: name.trim() },
      });
      // Make the new workspace active (persists cookie + refreshes server data).
      setActiveWorkspaceId(created.id);
      close();
    } catch (err) {
      setError((err as ApiError)?.message ?? "Could not create workspace");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create workspace"
      description="Workspaces keep accounts, campaigns, and contacts separate."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Outreach"
            maxLength={100}
            autoFocus
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
