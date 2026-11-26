-- Module: documents. Marking a scan as the card's front or back updates
-- documents_files.side in place (0063), so os_app gets UPDATE on that one
-- column, for the owner's own links only. Moving a link to another file or
-- document still means delete + insert, where the insert policy checks that
-- the file is the viewer's own.

create policy "document files: update own" on public.documents_files for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant update (side) on public.documents_files to os_app;
