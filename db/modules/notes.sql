-- Module: notes → the public /writing section. Apply after the drizzle
-- migration that adds notes_notes.is_public / slug / excerpt / published_at.
-- Owner rows stay as in 0002 (read/insert/update/delete own). New: anyone (no
-- viewer needed) may read the site owner's published notes, so private queries
-- in the app must also say "only mine" (owner_id = app.current_user_id()), as
-- links, ideas and projects already do. Grants are unchanged (0002).

create policy "notes: read published" on public.notes_notes for select to os_app
  using (is_public and owner_id = app.site_owner_id());
