import { MembersClient } from "@/components/settings/members-client";

export default function MembersSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">
          Invite teammates and manage their roles. Members are unlimited and free.
        </p>
      </header>
      <MembersClient />
    </div>
  );
}
