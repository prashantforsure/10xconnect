import { createAdminClient } from "./db-utils";

// A deterministic test fixture so RLS can be verified manually.
const SEED_EMAIL = "seed-user@10xconnect.test";
const SEED_PASSWORD = "Seed-User-Pw-1!";

async function main(): Promise<void> {
  const admin = createAdminClient();

  // 1) Create (or find) the seed auth user.
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
  });

  if (created.error) {
    // Likely already exists — look it up.
    const list = await admin.auth.admin.listUsers();
    userId = list.data.users.find((u) => u.email === SEED_EMAIL)?.id;
    if (!userId) {
      throw created.error;
    }
    console.log("seed user already existed:", userId);
  } else {
    userId = created.data.user.id;
    console.log("created seed user:", userId);
  }

  // 2) Ensure a workspace owned by the seed user.
  const { data: existingWs } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .limit(1);

  let workspaceId = existingWs?.[0]?.id as string | undefined;
  if (!workspaceId) {
    const ws = await admin
      .from("workspaces")
      .insert({ name: "Seed Workspace", owner_id: userId })
      .select("id")
      .single();
    if (ws.error) {
      throw ws.error;
    }
    workspaceId = ws.data.id as string;
    console.log("created workspace:", workspaceId);
  } else {
    console.log("workspace already existed:", workspaceId);
  }

  // 3) Ensure the owner membership.
  const membership = await admin
    .from("memberships")
    .upsert(
      { workspace_id: workspaceId, user_id: userId, role: "owner" },
      { onConflict: "workspace_id,user_id" },
    )
    .select("id")
    .single();
  if (membership.error) {
    throw membership.error;
  }
  console.log("ensured owner membership:", membership.data.id);

  console.log("\nSeed complete.");
  console.log(`  email:        ${SEED_EMAIL}`);
  console.log(`  password:     ${SEED_PASSWORD}`);
  console.log(`  user_id:      ${userId}`);
  console.log(`  workspace_id: ${workspaceId}`);
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
