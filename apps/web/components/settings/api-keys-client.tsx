"use client";

import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

interface ApiKey {
  id: string;
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
  const [loading, setLoading] = useState(true);
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
    setError(null);
    try {
      const res = await api.request<{ key: string }>("/api-keys", { method: "POST" });
      setNewKey(res.key);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not create key"));
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
      <div className="flex justify-end">
        <Button onClick={() => void create()}>
          <Plus />
          Generate key
        </Button>
      </div>

      {newKey ? (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm">
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
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : keys.length === 0 ? (
        <div className="surface-card border-dashed p-8 text-center text-sm text-muted-foreground">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <KeyRound className="size-6" />
          </span>
          No API keys yet.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-soft">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm">
                <span className="font-mono">10xc_••••••••</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  created {new Date(k.createdAt).toLocaleDateString()}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void revoke(k.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
