"use client";

import type { PromptCard } from "@10xconnect/core";
import { Heart, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Library {
  community: PromptCard[];
  saved: PromptCard[];
  mine: PromptCard[];
}

const EMPTY: Library = { community: [], saved: [], mine: [] };

/**
 * AI prompt library (E2). Tabs: Community (curated, read-only) | Saved (favorites)
 * | My Prompts. Search, create, favorite, and pick a prompt → inserts an AI chip
 * in the composer. The picked prompt's run-count is bumped server-side.
 */
export function PromptLibraryModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (card: PromptCard) => void;
}) {
  const api = useApi();
  const [lib, setLib] = useState<Library>(EMPTY);
  const [tab, setTab] = useState<"community" | "saved" | "mine">("community");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLib(await api.request<Library>("/ai/library"));
    } catch {
      setLib(EMPTY);
    }
  }, [api]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const toggleFavorite = async (card: PromptCard): Promise<void> => {
    const next = !card.favorited;
    try {
      await api.request("/ai/prompts/favorite", {
        method: "POST",
        body: { ref: card.ref, favorited: next },
      });
      await load();
    } catch {
      // ignore — non-critical
    }
  };

  const pick = (card: PromptCard): void => {
    if (card.ref.startsWith("workspace:")) {
      void api.request("/ai/prompts/use", { method: "POST", body: { ref: card.ref } }).catch(() => undefined);
    }
    onPick(card);
    onClose();
  };

  const create = async (): Promise<void> => {
    if (!newName.trim() || !newTemplate.trim()) {
      return;
    }
    setError(null);
    try {
      const card = await api.request<PromptCard>("/ai/prompts", {
        method: "POST",
        body: { name: newName.trim(), template: newTemplate.trim() },
      });
      setCreating(false);
      setNewName("");
      setNewTemplate("");
      await load();
      pick(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create prompt");
    }
  };

  const cards = useMemo(() => {
    const list = lib[tab];
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => `${c.title} ${c.template}`.toLowerCase().includes(q)) : list;
  }, [lib, tab, query]);

  return (
    <Modal open={open} onClose={onClose} title="AI Prompts" className="max-w-2xl">
      {creating ? (
        <div className="space-y-3">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Prompt name" />
          <Textarea
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value)}
            className="min-h-[120px]"
            placeholder="Instructions… reference fields like {{Headline}} {{Company Overview}}"
          />
          <p className="text-[11px] text-muted-foreground">
            Use {"{{Headline}}"}, {"{{Biography}}"}, {"{{Company Overview}}"} etc. — filled per lead at send time.
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()} disabled={!newName.trim() || !newTemplate.trim()}>
              Create &amp; insert
            </Button>
          </div>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="community">Community</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
              <TabsTrigger value="mine">My Prompts</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Create my prompt
            </Button>
          </div>

          <div className="relative my-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a prompt"
              className="pl-9"
            />
          </div>

          {(["community", "saved", "mine"] as const).map((t) => (
            <TabsContent key={t} value={t}>
              <div className="max-h-[50vh] space-y-2 overflow-auto pr-1">
                {cards.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t === "saved"
                      ? "No saved prompts yet — favorite one to keep it here."
                      : t === "mine"
                        ? "No prompts yet — create one."
                        : "No prompts match your search."}
                  </p>
                ) : (
                  cards.map((card) => (
                    <PromptCardRow
                      key={card.ref}
                      card={card}
                      onPick={() => pick(card)}
                      onToggleFavorite={() => void toggleFavorite(card)}
                    />
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </Modal>
  );
}

function PromptCardRow({
  card,
  onPick,
  onToggleFavorite,
}: {
  card: PromptCard;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-soft transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onPick} className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold">{card.title}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{card.template}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="muted">{card.runCount.toLocaleString()} runs</Badge>
            <span className="text-[11px] text-muted-foreground">by {card.author}</span>
          </div>
        </button>
        <button
          type="button"
          aria-label={card.favorited ? "Unfavorite" : "Favorite"}
          onClick={onToggleFavorite}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary"
        >
          <Heart className={cn("size-4", card.favorited && "fill-primary text-primary")} />
        </button>
      </div>
    </div>
  );
}
