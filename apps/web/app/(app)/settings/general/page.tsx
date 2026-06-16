import { GeneralSettingsForm } from "@/components/settings/general-form";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveWorkspaceId } from "@/lib/workspace/server";

interface WorkspaceSettings {
  inbox_type?: string;
  auto_withdraw_days?: number;
}

export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Profile + workspaces are read via RLS (the user can only see their own
  // profile row and workspaces they belong to). Mutations go through the API
  // (workspace) and the profile row (RLS), wired in the client form.
  const [{ data: profile }, { data: workspaceRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", user?.id ?? "")
      .maybeSingle(),
    supabase.from("workspaces").select("id, name, settings").order("created_at", { ascending: true }),
  ]);

  const workspaces = workspaceRows ?? [];
  const activeId = await resolveActiveWorkspaceId(workspaces.map((w) => w.id));
  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? null;
  const settings = (activeWorkspace?.settings ?? {}) as WorkspaceSettings;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">Profile and workspace settings.</p>
      </header>

      <GeneralSettingsForm
        profile={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          email: profile?.email ?? user?.email ?? "",
        }}
        workspace={
          activeWorkspace
            ? {
                id: activeWorkspace.id,
                name: activeWorkspace.name,
                inboxType: settings.inbox_type ?? "not_configured",
                autoWithdrawDays:
                  typeof settings.auto_withdraw_days === "number" ? settings.auto_withdraw_days : 14,
              }
            : null
        }
      />
    </div>
  );
}
