import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceProvider, type WorkspaceSummary } from "@/lib/workspace/context";
import { resolveActiveWorkspaceId } from "@/lib/workspace/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards these routes; this is defense-in-depth.
  if (!user) {
    redirect("/login");
  }

  // RLS returns only workspaces the user is a member of (oldest first).
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });

  const workspaces: WorkspaceSummary[] = (data ?? []).map((w) => ({ id: w.id, name: w.name }));
  // Active workspace follows the persisted cookie selection (validated against
  // membership), falling back to the first workspace.
  const initialWorkspaceId = await resolveActiveWorkspaceId(workspaces.map((w) => w.id));

  return (
    <WorkspaceProvider workspaces={workspaces} initialWorkspaceId={initialWorkspaceId}>
      <AppShell userEmail={user.email ?? ""}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
