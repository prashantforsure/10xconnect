"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

interface Provider {
  id: string;
  name: string;
  category: string;
  connected: boolean;
}

export function IntegrationsClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      setProviders(await api.request<Provider[]>("/integrations"));
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (id: string): Promise<void> => {
    try {
      const res = await api.request<{ message: string }>(`/integrations/${id}/connect`, { method: "POST" });
      setMsg(res.message);
    } catch {
      setMsg("Integration unavailable.");
    }
  };

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {msg ? (
        <div className="rounded-xl border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
          {msg}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="surface-card flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-secondary font-display text-sm font-bold">
                {p.name.charAt(0)}
              </span>
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.category}</div>
              </div>
            </div>
            {p.connected ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void connect(p.id)}>
                Connect
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
