"use client";

import type { AttachmentKind, ComposerAttachment } from "@10xconnect/core";
import { FileText, Film, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "campaign-media";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ACCEPT: Record<AttachmentKind, string> = {
  image: "image/*",
  video: "video/*",
  file: "*/*",
};

const KIND_ICON = {
  image: ImageIcon,
  video: Film,
  file: FileText,
} as const;

/**
 * "Add" menu — uploads Images/Videos/Files to the private campaign-media Storage
 * bucket (workspace-scoped path) and records the storage ref in node config. The
 * ref is the source of truth: at dispatch the engine mints a FRESH signed URL
 * from it (the one stored here is a short-lived preview) and the adapter
 * delivers the bytes through the transport.
 */
export function AttachmentMenu({
  attachments,
  onChange,
  workspaceId,
  campaignId,
  disabled,
}: {
  attachments: ComposerAttachment[];
  onChange: (next: ComposerAttachment[]) => void;
  workspaceId: string;
  campaignId: string;
  disabled?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<AttachmentKind>("file");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (kind: AttachmentKind): void => {
    pendingKind.current = kind;
    if (inputRef.current) {
      inputRef.current.accept = ACCEPT[kind];
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const onFile = async (file: File): Promise<void> => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("File is larger than 25 MB.");
      return;
    }
    setBusy(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${workspaceId}/${campaignId}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) {
        throw upErr;
      }
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      const next: ComposerAttachment = {
        kind: pendingKind.current,
        ref: path,
        ...(signed?.signedUrl ? { url: signed.signedUrl } : {}),
        name: file.name,
        mime: file.type || undefined,
        size: file.size,
      };
      onChange([...attachments, next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (ref: string): void => onChange(attachments.filter((a) => a.ref !== ref));

  return (
    <div className="space-y-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy}>
            <Paperclip className="size-4" />
            {busy ? "Uploading…" : "Add"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => pick("image")}>
            <ImageIcon className="size-4" />
            Images
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick("video")}>
            <Film className="size-4" />
            Videos
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick("file")}>
            <FileText className="size-4" />
            Files
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void onFile(file);
          }
        }}
      />

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <span
                key={a.ref}
                className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-xs"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name ?? a.kind}</span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => remove(a.ref)}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
