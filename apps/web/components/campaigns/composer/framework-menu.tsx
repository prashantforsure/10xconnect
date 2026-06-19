"use client";

import {
  frameworkOpenerBody,
  type MessageBody,
  OBSERVATION_SNIPPETS,
  SOFT_QUESTION_SNIPPETS,
} from "@10xconnect/core";
import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Two-part-framework helper (CLAUDE.md §2 default message pattern): insert the
 * default opener (personalized observation + soft question), or splice an
 * observation / soft-question snippet at the caret.
 */
export function FrameworkMenu({
  onSetBody,
  onInsertText,
  disabled,
}: {
  onSetBody: (body: MessageBody) => void;
  onInsertText: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Wand2 className="size-4" />
          Framework
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-auto">
        <DropdownMenuItem onSelect={() => onSetBody(frameworkOpenerBody())}>
          <span className="text-sm font-medium">Insert default opener</span>
        </DropdownMenuItem>
        <p className="px-2.5 pb-1 text-[11px] text-muted-foreground">
          Personalized observation + soft question.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Soft questions</DropdownMenuLabel>
        {SOFT_QUESTION_SNIPPETS.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onInsertText(s)}>
            {s}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Observations</DropdownMenuLabel>
        {OBSERVATION_SNIPPETS.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onInsertText(s)}>
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
