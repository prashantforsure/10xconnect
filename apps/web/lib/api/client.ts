"use client";

import { useMemo } from "react";

import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  workspaceId?: string | null;
}

/** Low-level typed fetch against the NestJS API with auth + workspace headers. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.workspaceId) {
    headers["X-Workspace-Id"] = options.workspaceId;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const envelope = data as { error?: ApiError } | null;
    throw (
      envelope?.error ?? {
        statusCode: response.status,
        code: "error",
        message: response.statusText,
      }
    );
  }

  return data as T;
}

/**
 * Hook returning an API client bound to the current Supabase session token and
 * the active workspace (sends X-Workspace-Id). Used by feature code in later steps.
 */
export function useApi() {
  const { activeWorkspaceId } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);

  return useMemo(
    () => ({
      request: async <T,>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> => {
        const { data } = await supabase.auth.getSession();
        return apiFetch<T>(path, {
          ...opts,
          token: data.session?.access_token ?? null,
          workspaceId: activeWorkspaceId,
        });
      },
    }),
    [supabase, activeWorkspaceId],
  );
}
