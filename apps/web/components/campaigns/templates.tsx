"use client";

import type { RequiredInput } from "@10xconnect/core";
import { CheckCircle2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type Scope = "private" | "workspace" | "community";

interface TemplateView {
  id: string;
  name: string;
  scope: Scope;
  templateVersion: number;
  graph: { kind: string; type: string }[];
  requiredInputs: RequiredInput[];
  createdAt?: string;
}
interface ApplyResult {
  campaignId: string;
  requiredInputs: RequiredInput[];
}

const SCOPE_TABS: { value: Scope; label: string; hint: string }[] = [
  { value: "private", label: "My templates", hint: "Only you can see these." },
  { value: "workspace", label: "Workspace", hint: "Shared with your team." },
  { value: "community", label: "Community", hint: "Public, reusable starting points." },
];

const SCOPE_LABEL: Record<Scope, string> = {
  private: "Private",
  workspace: "Workspace",
  community: "Community",
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as ApiError)?.message ?? (err instanceof Error ? err.message : fallback);
}

// --- Template library (browse → apply → fresh draft + required inputs) ------

export function TemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("private");
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ result: ApplyResult; name: string } | null>(null);
  // Guards against a stale scope response landing after a newer tab switch.
  const reqRef = useRef(0);

  const load = useCallback(
    async (s: Scope) => {
      const reqId = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await api.request<TemplateView[]>(`/workflow-templates?scope=${s}`);
        if (reqId === reqRef.current) {
          setTemplates(res);
        }
      } catch (err) {
        if (reqId === reqRef.current) {
          setError(errorMessage(err, "Could not load templates"));
        }
      } finally {
        if (reqId === reqRef.current) {
          setLoading(false);
        }
      }
    },
    [api],
  );

  useEffect(() => {
    if (open && !applied) {
      void load(scope);
    }
  }, [open, scope, applied, load]);

  const close = (): void => {
    setApplied(null);
    setError(null);
    onClose();
  };

  const apply = async (t: TemplateView): Promise<void> => {
    setApplyingId(t.id);
    setError(null);
    try {
      const result = await api.request<ApplyResult>(`/workflow-templates/${t.id}/apply`, {
        method: "POST",
        body: {},
      });
      setApplied({ result, name: t.name });
    } catch (err) {
      setError(errorMessage(err, "Could not apply template"));
    } finally {
      setApplyingId(null);
    }
  };

  const remove = async (t: TemplateView): Promise<void> => {
    setError(null);
    try {
      await api.request(`/workflow-templates/${t.id}`, { method: "DELETE" });
      await load(scope);
    } catch (err) {
      setError(errorMessage(err, "Could not delete template"));
    }
  };

  const openCampaign = (): void => {
    if (!applied) {
      return;
    }
    router.push(`/campaigns/${applied.result.campaignId}`);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={applied ? "Campaign created from template" : "Templates"}
      description={
        applied
          ? "A fresh draft campaign was cloned from the template — with 0 contacts and none of the original's leads, account, or knowledge base."
          : "Reusable campaign shapes (sequence + AI prompts + cadence + brain defaults). Applying one creates a new draft you fill with your own contacts and facts."
      }
      className="max-w-2xl"
    >
      {applied ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-secondary/30 p-3 text-sm">
            <p className="font-medium">{applied.name}</p>
            <p className="mt-0.5 text-muted-foreground">Created a draft campaign with 0 contacts.</p>
          </div>
          {applied.result.requiredInputs.filter((r) => r.required).length > 0 ? (
            <div>
              <p className="mb-1.5 text-sm font-medium">Before you can launch, add:</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {applied.result.requiredInputs
                  .filter((r) => r.required)
                  .map((r) => (
                    <li key={r.key}>• {r.label}</li>
                  ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Done
            </Button>
            <Button onClick={openCampaign}>Open campaign</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Scope tabs */}
          <div className="flex flex-wrap gap-2">
            {SCOPE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={scope === t.value}
                onClick={() => setScope(t.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  scope === t.value
                    ? "bg-foreground text-background"
                    : "border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {SCOPE_TABS.find((t) => t.value === scope)?.hint}
          </p>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No {SCOPE_LABEL[scope].toLowerCase()} templates yet.
              {scope !== "community"
                ? " Save a campaign as a template from its page to reuse its shape."
                : ""}
            </div>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {templates.map((t) => {
                const steps = t.graph?.length ?? 0;
                const needs = t.requiredInputs?.filter((r) => r.required).length ?? 0;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {SCOPE_LABEL[t.scope]}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {steps} step{steps === 1 ? "" : "s"}
                        {needs > 0 ? ` · needs ${needs} input${needs === 1 ? "" : "s"} before launch` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {scope !== "community" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => void remove(t)}
                          aria-label={`Delete ${t.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => void apply(t)} disabled={applyingId !== null}>
                        {applyingId === t.id ? "Applying…" : "Apply"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

// --- Save a campaign as a template -----------------------------------------

export function SaveAsTemplateModal({
  open,
  onClose,
  campaignId,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  defaultName?: string;
}) {
  const api = useApi();
  const [name, setName] = useState(defaultName ?? "");
  const [scope, setScope] = useState<Scope>("private");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ name: string; scope: Scope } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the name to the current campaign each time the modal opens.
  useEffect(() => {
    if (open) {
      setName(defaultName ?? "");
      setScope("private");
      setSaved(null);
      setError(null);
    }
  }, [open, defaultName]);

  const close = (): void => {
    setSaved(null);
    setError(null);
    onClose();
  };

  const save = async (): Promise<void> => {
    if (!name.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.request("/workflow-templates", {
        method: "POST",
        body: { campaignId, name: name.trim(), scope },
      });
      setSaved({ name: name.trim(), scope });
    } catch (err) {
      setError(errorMessage(err, "Could not save template"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Save as template"
      description="Reuse this campaign's shape later. Only the structure is saved — never your leads, sending account, knowledge base, or per-contact messages."
    >
      {saved ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div>
              <p className="font-medium">
                Saved “{saved.name}” as a {SCOPE_LABEL[saved.scope].toLowerCase()} template.
              </p>
              <p className="text-muted-foreground">
                Sequence, AI prompts, cadence, and brain defaults were saved. Your leads, account,
                knowledge base, and resolved messages were left out.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tmpl-name">Template name</Label>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Founder outreach — gentle"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tmpl-scope">Who can use it</Label>
            <Select id="tmpl-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="private">Private — only me</option>
              <option value="workspace">Workspace — my team</option>
              <option value="community">Community — anyone</option>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : "Save template"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
