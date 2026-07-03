"use client";

import {
  isBodyConfigured,
  LINKEDIN_LIMITS,
  type MessageBody,
  type PromptCard,
  renderMessageBody,
  varietyWarning,
} from "@10xconnect/core";
import { AlertTriangle, Eye, RefreshCw, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AiPromptButton } from "./ai-prompt-button";
import { AttachmentMenu } from "./attachment-menu";
import { BodyEditor, type BodyEditorHandle } from "./body-editor";
import { EditAiPromptModal } from "./edit-ai-prompt-modal";
import { FrameworkMenu } from "./framework-menu";
import { GuardrailsPanel } from "./guardrails-panel";
import { PreviewModal, type PreviewItem, type PreviewSample } from "./preview-modal";
import { PromptLibraryModal } from "./prompt-library-modal";
import { SendConditionSelect } from "./send-condition-select";
import { SenderSelect, type SenderAccount } from "./sender-select";
import { VariablePicker } from "./variable-picker";
import { VoiceNoteFields } from "./voice-note-fields";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SlideOver } from "@/components/ui/slide-over";
import { useApi } from "@/lib/api/client";
import {
  bodyConfigPatch,
  CHANGEABLE_TYPES,
  hasTextBody,
  readComposer,
} from "@/lib/campaigns/composer";
import { nodeLabel } from "@/lib/campaigns/nodes";

interface RenderPreviewResponse {
  results: { name: string; text: string }[];
  varietyWarning: string | null;
}

// Local AI stub used only when the server returns no sample leads (empty workspace).
const AI_SAMPLES = [
  "saw your recent launch",
  "noticed your team is scaling",
  "love what you're building",
  "saw you're hiring quickly",
  "impressed by your growth",
];
function localAiStub(leadIndex: number, seed: number): string {
  return AI_SAMPLES[(leadIndex + seed) % AI_SAMPLES.length];
}

// LinkedIn hard caps per body surface — surfaced as advisory counters (E3).
const BODY_CHAR_LIMITS: Record<string, number> = {
  inmail: LINKEDIN_LIMITS.inmailBody,
  send_message: LINKEDIN_LIMITS.message,
  send_message_to_open_profile: LINKEDIN_LIMITS.message,
};

export function ComposerPanel({
  type,
  config,
  onConfigChange,
  onChangeType,
  onCollapse,
  accounts,
  workspaceId,
  campaignId,
  leadCount,
  running,
  loadSamples,
}: {
  type: string;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onChangeType: (type: string) => void;
  /** Collapse/close the docked panel (hides it and frees the canvas width). */
  onCollapse?: () => void;
  accounts: SenderAccount[];
  workspaceId: string;
  campaignId: string;
  leadCount: number;
  running: boolean;
  loadSamples: () => Promise<PreviewSample[]>;
}) {
  const api = useApi();
  const editorRef = useRef<BodyEditorHandle>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editAiOpen, setEditAiOpen] = useState(false);
  const [editAiPrompt, setEditAiPrompt] = useState("");
  const seedRef = useRef(0);

  // The panel is full-focus: the builder mounts it only when a step is selected,
  // so "mounted" === "open". We flip `open` true after mount so the SlideOver
  // animates in, and close it by calling onCollapse (which unmounts us). When no
  // onCollapse is provided, fall back to local state so the panel still closes.
  const [open, setOpen] = useState(false);
  // Guards setState in async preview handlers against a panel that unmounted
  // mid-fetch (the builder unmounts us the instant a step is deselected).
  const mountedRef = useRef(true);
  useEffect(() => {
    setOpen(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const close = (): void => {
    // Don't let a backdrop click or Escape on a nested modal (preview, prompt
    // library, edit-AI) also collapse the whole composer — those own that gesture.
    if (previewOpen || libraryOpen || editAiOpen) {
      return;
    }
    setOpen(false);
    onCollapse?.();
  };

  const state = readComposer(type, config);
  const isText = hasTextBody(type);

  const update = (partial: Record<string, unknown>): void => {
    onConfigChange({ ...config, ...partial });
  };

  const onBody = (body: MessageBody): void => update(bodyConfigPatch(type, body));

  const misconfigured = isText
    ? !isBodyConfigured(state.body)
    : type === "send_voice_note" && !state.audioRef.trim();

  const runPreview = async (body: MessageBody): Promise<void> => {
    setPreviewLoading(true);
    try {
      const res = await api.request<RenderPreviewResponse>("/ai/render-preview", {
        method: "POST",
        body: { segments: body.segments },
      });
      if (res.results.length > 0) {
        if (!mountedRef.current) return;
        setPreviewItems(res.results.map((r) => ({ name: r.name, text: r.text })));
        setPreviewWarning(res.varietyWarning);
        return;
      }
    } catch {
      // fall through to local demo render
    }
    // Local fallback (empty workspace / API unavailable): demo leads + stub AI.
    const seed = seedRef.current;
    const samples = await loadSamples().catch(() => [] as PreviewSample[]);
    if (!mountedRef.current) return;
    const aiOut: string[] = [];
    const items = samples.map((s, i) => ({
      name: s.name,
      text: renderMessageBody(body, s.vars, {
        renderAi: () => {
          const out = localAiStub(i, seed);
          aiOut.push(out);
          return out;
        },
      }),
    }));
    setPreviewItems(items);
    setPreviewWarning(varietyWarning(aiOut));
  };

  const openPreview = async (): Promise<void> => {
    setPreviewOpen(true);
    setPreviewItems([]);
    setPreviewWarning(null);
    await runPreview(state.body).finally(() => setPreviewLoading(false));
  };

  const regenerate = (): void => {
    seedRef.current += 1;
    void runPreview(state.body).finally(() => setPreviewLoading(false));
  };

  const insertPrompt = (card: PromptCard): void => {
    editorRef.current?.insertAi(card.template, card.ref);
  };

  return (
    <SlideOver
      open={open}
      onClose={close}
      title={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-base font-semibold tracking-tight">
              {nodeLabel(type)}
            </div>
            <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
              {running ? "Editing live step — changes apply to future sends" : "Editing step"}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                // Changing the action TYPE is structural — locked while live.
                disabled={running}
                title={running ? "Stop the campaign to change this step's action type" : undefined}
                className="shrink-0 border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary"
              >
                <RefreshCw className="size-4" />
                Change
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CHANGEABLE_TYPES.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onSelect={() => {
                    if (t !== type) {
                      onChangeType(t);
                    }
                  }}
                >
                  {nodeLabel(t)}
                  {t === type ? <span className="ml-auto text-xs text-primary">current</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {/* Sender */}
        <SenderSelect
          accounts={accounts}
          value={state.senders}
          onChange={(senders) => update({ senders })}
        />

        {/* InMail subject */}
        {type === "inmail" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <span
                className={
                  state.subject.length > LINKEDIN_LIMITS.inmailSubject
                    ? "text-[11px] font-medium tabular-nums text-destructive"
                    : "text-[11px] tabular-nums text-muted-foreground"
                }
              >
                {state.subject.length}/{LINKEDIN_LIMITS.inmailSubject}
              </span>
            </div>
            <Input
              value={state.subject}
              onChange={(e) => update({ subject: e.target.value })}
              placeholder="Quick question"
            />
          </div>
        ) : null}

        {isText ? (
          <div className="space-y-2">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <AiPromptButton
                onInsert={(prompt, promptId) => editorRef.current?.insertAi(prompt, promptId)}
                onOpenPromptLibrary={() => setLibraryOpen(true)}
              />
              <VariablePicker
                onInsert={(key, fallback) => editorRef.current?.insertVariable(key, fallback)}
              />
              <FrameworkMenu
                onSetBody={onBody}
                onInsertText={(t) => editorRef.current?.insertText(t)}
              />
              <AttachmentMenu
                attachments={state.attachments}
                onChange={(attachments) => update({ attachments })}
                workspaceId={workspaceId}
                campaignId={campaignId}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => void openPreview()}>
                <Eye className="size-4" />
                Preview
              </Button>
            </div>

            {/* Body */}
            <BodyEditor
              ref={editorRef}
              value={state.body}
              onChange={onBody}
              placeholder="Write your message… insert variables and an AI prompt above."
              onEditAi={(current) => {
                setEditAiPrompt(current.prompt ?? "");
                setEditAiOpen(true);
              }}
            />

            {/* Sales-guard linter + above-the-fold + char counter (advisory) */}
            <GuardrailsPanel body={state.body} charLimit={BODY_CHAR_LIMITS[type]} />
          </div>
        ) : (
          // Voice note — recorded/clone mode, ≤30s meter, tips, audio ref (§6 voice).
          <div className="space-y-2">
            <VoiceNoteFields
              config={config}
              onChange={update}
              workspaceId={workspaceId}
              campaignId={campaignId}
            />
            <AttachmentMenu
              attachments={state.attachments}
              onChange={(attachments) => update({ attachments })}
              workspaceId={workspaceId}
              campaignId={campaignId}
            />
          </div>
        )}

        {/* Send condition */}
        <SendConditionSelect
          value={state.sendCondition}
          onChange={(sendCondition) => update({ sendCondition })}
        />

        {/* Footer: status + lead counter */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          {misconfigured ? (
            <Badge variant="warning">
              <AlertTriangle className="size-3.5" />
              Action required
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Ready</span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {leadCount}
          </span>
        </div>
      </div>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        items={previewItems}
        varietyWarning={previewWarning}
        loading={previewLoading}
        onRegenerate={regenerate}
      />
      <PromptLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} onPick={insertPrompt} />
      <EditAiPromptModal
        open={editAiOpen}
        initialPrompt={editAiPrompt}
        onClose={() => setEditAiOpen(false)}
        onSave={(prompt) => {
          // Edited inline → it's now a custom prompt, so drop the library ref.
          editorRef.current?.updateEditingAi(prompt || undefined, undefined);
          setEditAiOpen(false);
        }}
      />
    </SlideOver>
  );
}
