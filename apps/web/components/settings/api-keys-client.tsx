"use client";

import { Check, Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/loader";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

type Permission = "all" | "read_only";

interface ApiKey {
  id: string;
  name: string;
  permission: Permission;
  /** Display prefix of the plaintext (null for keys created before v2). */
  prefix: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function ApiKeysClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<Permission>("all");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      setKeys(await api.request<ApiKey[]>("/api-keys"));
    } catch (err) {
      setError(errorMessage(err, "Could not load keys"));
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (creating) {
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await api.request<{ key: string }>("/api-keys", {
        method: "POST",
        body: {
          ...(name.trim() ? { name: name.trim() } : {}),
          permission,
        },
      });
      setNewKey(res.key);
      setName("");
      setPermission("all");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not create key"));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (id: string): Promise<void> => {
    const value = renameValue.trim();
    if (!value) {
      return;
    }
    try {
      await api.request(`/api-keys/${id}`, { method: "PATCH", body: { name: value } });
      setRenamingId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not rename key"));
    }
  };

  const revoke = async (id: string): Promise<void> => {
    try {
      await api.request(`/api-keys/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not revoke key"));
    }
  };

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Create form — name + permission, Aimfox parity */}
      <div className="surface-card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[180px] flex-1 space-y-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zapier, n8n, MCP"
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="key-permission">Permission</Label>
          <Select
            id="key-permission"
            className="w-[150px]"
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            <option value="all">All</option>
            <option value="read_only">Read-only</option>
          </Select>
        </div>
        <Button onClick={() => void create()} disabled={creating}>
          <Plus />
          {creating ? "Generating…" : "Generate key"}
        </Button>
      </div>

      {newKey ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-medium text-success">Copy your key now — it won&apos;t be shown again:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-card px-2 py-1 text-xs">{newKey}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(newKey)}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Use it as <code>Authorization: Bearer &lt;key&gt;</code> against the API — the key is
            scoped to this workspace (no X-Workspace-Id header needed).
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <PageLoader />
      ) : keys.length === 0 ? (
        <div className="surface-card border-dashed p-8 text-center text-sm text-muted-foreground">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="size-6" />
          </span>
          No API keys yet.
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-border bg-card">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
            >
              <div className="min-w-0 flex-1 text-sm">
                {renamingId === k.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void rename(k.id);
                        }
                        if (e.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                      className="h-8 max-w-[220px]"
                      maxLength={80}
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Save name"
                      title="Save"
                      className="size-7"
                      onClick={() => void rename(k.id)}
                    >
                      <Check className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Cancel rename"
                      title="Cancel"
                      className="size-7"
                      onClick={() => setRenamingId(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{k.name}</span>
                    <Badge variant={k.permission === "read_only" ? "secondary" : "outline"}>
                      {k.permission === "read_only" ? "Read-only" : "All"}
                    </Badge>
                  </div>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="font-mono">{k.prefix ? `${k.prefix}…` : "10xc_…"}</span>
                  <span>created {new Date(k.createdAt).toLocaleDateString()}</span>
                  <span>
                    {k.lastUsedAt
                      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                      : "never used"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Rename ${k.name}`}
                  title="Rename"
                  onClick={() => {
                    setRenamingId(k.id);
                    setRenameValue(k.name);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${k.name}`}
                  title="Revoke"
                  className="text-destructive"
                  onClick={() => void revoke(k.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
