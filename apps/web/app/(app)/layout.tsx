import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceProvider, type WorkspaceSummary } from "@/lib/workspace/context";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards these routes; this is defense-in-depth.
  if (!user) {
    redirect("/login");
  }

  // RLS returns only workspaces the user is a member of. Workspace CRUD is Step 5;
  // for now default the active workspace to the first one.
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });

  const workspaces: WorkspaceSummary[] = (data ?? []).map((w) => ({ id: w.id, name: w.name }));
  const initialWorkspaceId = workspaces[0]?.id ?? null;

  return (
    <WorkspaceProvider workspaces={workspaces} initialWorkspaceId={initialWorkspaceId}>
      <AppShell userEmail={user.email ?? ""}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
