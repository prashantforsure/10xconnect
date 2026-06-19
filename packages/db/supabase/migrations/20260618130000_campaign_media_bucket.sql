-- Private Storage bucket for campaign message media (images/videos/files attached
-- in the composer — CLAUDE.md §7). Objects are namespaced by workspace:
--   campaign-media/{workspace_id}/{campaign_id}/{uuid}-{filename}
-- Access is restricted to members of the object's workspace, reusing the same
-- public.is_workspace_member() helper as the table RLS (defense-in-depth; the
-- server/worker uses the service key which bypasses RLS).

insert into storage.buckets (id, name, public)
values ('campaign-media', 'campaign-media', false)
on conflict (id) do nothing;

-- The first path segment is the workspace id (see upload path convention above).
create policy "campaign_media_select_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'campaign-media'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy "campaign_media_insert_members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'campaign-media'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy "campaign_media_update_members" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'campaign-media'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'campaign-media'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy "campaign_media_delete_members" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'campaign-media'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
