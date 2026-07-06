"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/loader";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { useWorkspace } from "@/lib/workspace/context";

interface Branding {
  brandName?: string;
  primaryColor?: string;
  logoUrl?: string;
  customDomain?: string;
}
interface WorkspaceView {
  id: string;
  branding: Branding;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

export function WhiteLabelClient() {
  const api = useApi();
  const { activeWorkspaceId } = useWorkspace();
  const [branding, setBranding] = useState<Branding>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }
    setLoading(true);
    try {
      const ws = await api.request<WorkspaceView[]>("/workspaces");
      setBranding(ws.find((w) => w.id === activeWorkspaceId)?.branding ?? {});
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, [api, activeWorkspaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!activeWorkspaceId) {
      return;
    }
    setMsg(null);
    try {
      await api.request(`/workspaces/${activeWorkspaceId}`, { method: "PATCH", body: { branding } });
      setMsg("Saved");
    } catch (err) {
      setMsg(errorMessage(err, "Could not save"));
    }
  };

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">Select a workspace.</p>;
  }
  if (loading) {
    return <PageLoader />;
  }

  return (
    <div className="max-w-md">
      <div className="surface-card space-y-4 p-6">
        <p className="text-sm text-muted-foreground">
          Branding is applied to the client-facing campaign reports you share (Campaign → ⋯ → Share).
        </p>
        <div className="space-y-2">
          <Label htmlFor="wl-name">Brand name</Label>
          <Input
            id="wl-name"
            value={branding.brandName ?? ""}
            onChange={(e) => setBranding({ ...branding, brandName: e.target.value })}
            placeholder="Your Agency"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wl-logo">Logo URL</Label>
          <div className="flex items-center gap-2">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logoUrl}
                alt="Logo preview"
                className="h-10 w-10 shrink-0 rounded-lg border object-contain"
              />
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border text-xs text-muted-foreground">
                —
              </span>
            )}
            <Input
              id="wl-logo"
              value={branding.logoUrl ?? ""}
              onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })}
              placeholder="https://youragency.com/logo.png"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A hosted image URL (PNG/SVG). Shown at the top of every client report.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wl-color">Primary color</Label>
          <div className="flex items-center gap-2">
            <span
              className="size-10 shrink-0 rounded-lg border"
              style={{ background: branding.primaryColor || "transparent" }}
            />
            <Input
              id="wl-color"
              type="text"
              value={branding.primaryColor ?? ""}
              onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
              placeholder="#5E6AD2"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wl-domain">Custom domain</Label>
          <Input
            id="wl-domain"
            value={branding.customDomain ?? ""}
            onChange={(e) => setBranding({ ...branding, customDomain: e.target.value })}
            placeholder="app.youragency.com"
          />
          <p className="text-xs text-muted-foreground">
            Point a CNAME to our servers (DNS setup is a later step). Branding applies to
            client-facing reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()}>Save branding</Button>
          {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}
