"use client";

import {
  isBodyConfigured,
  type MessageBody,
  type PromptCard,
  renderMessageBody,
  varietyWarning,
} from "@10xconnect/core";
import { AlertTriangle, Eye, PanelRightClose, RefreshCw, Users } from "lucide-react";
import { useRef, useState } from "react";

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
    <div className="space-y-4">
      {/* Header + Change action type */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{nodeLabel(type)}</div>
          <p className="text-xs text-muted-foreground">Configure this step</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={running}>
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
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse panel"
              title="Collapse panel"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PanelRightClose className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Sender */}
      <SenderSelect
        accounts={accounts}
        value={state.senders}
        onChange={(senders) => update({ senders })}
        disabled={running}
      />

      {/* InMail subject */}
      {type === "inmail" ? (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <Input
            value={state.subject}
            onChange={(e) => update({ subject: e.target.value })}
            placeholder="Quick question"
            disabled={running}
          />
        </div>
      ) : null}

      {isText ? (
        <div className="space-y-2">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <AiPromptButton
              disabled={running}
              onInsert={(prompt, promptId) => editorRef.current?.insertAi(prompt, promptId)}
              onOpenPromptLibrary={() => setLibraryOpen(true)}
            />
            <VariablePicker
              disabled={running}
              onInsert={(key, fallback) => editorRef.current?.insertVariable(key, fallback)}
            />
            <FrameworkMenu
              disabled={running}
              onSetBody={onBody}
              onInsertText={(t) => editorRef.current?.insertText(t)}
            />
            <AttachmentMenu
              attachments={state.attachments}
              onChange={(attachments) => update({ attachments })}
              workspaceId={workspaceId}
              campaignId={campaignId}
              disabled={running}
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
            disabled={running}
            placeholder="Write your message… insert variables and an AI prompt above."
            onEditAi={
              running
                ? undefined
                : (current) => {
                    setEditAiPrompt(current.prompt ?? "");
                    setEditAiOpen(true);
                  }
            }
          />

          {/* Sales-guard linter + above-the-fold (advisory) */}
          <GuardrailsPanel body={state.body} />
        </div>
      ) : (
        // Voice note — recorded/clone mode, ≤30s meter, tips, audio ref (§6 voice).
        <div className="space-y-2">
          <VoiceNoteFields
            config={config}
            onChange={update}
            disabled={running}
            workspaceId={workspaceId}
            campaignId={campaignId}
          />
          <AttachmentMenu
            attachments={state.attachments}
            onChange={(attachments) => update({ attachments })}
            workspaceId={workspaceId}
            campaignId={campaignId}
            disabled={running}
          />
        </div>
      )}

      {/* Send condition */}
      <SendConditionSelect
        value={state.sendCondition}
        onChange={(sendCondition) => update({ sendCondition })}
        disabled={running}
      />

      {/* Footer: status + lead counter */}
      <div className="flex items-center justify-between border-t pt-3">
        {misconfigured ? (
          <Badge variant="warning">
            <AlertTriangle className="size-3.5" />
            Action required
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Ready</span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          {leadCount}
        </span>
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
    </div>
  );
}
