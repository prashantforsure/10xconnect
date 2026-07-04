import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { createClient } from "@/lib/supabase/server";

/** A friendly first name for the greeting: profile/OAuth name, else the email local part. */
function greetingName(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const meta = user?.user_metadata ?? {};
  const fromMeta =
    (meta.first_name as string) ||
    (meta.given_name as string) ||
    ((meta.name as string) || (meta.full_name as string) || "").split(" ")[0];
  const raw = (fromMeta || user?.email?.split("@")[0] || "").trim();
  if (!raw) {
    return "there";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-7xl px-6 py-7 lg:px-8">
      <DashboardClient greetingName={greetingName(user)} />
    </div>
  );
}
