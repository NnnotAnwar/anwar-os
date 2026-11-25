-- Module: documents. Triggers, row-level security and grants for
-- documents_documents and documents_files (drizzle schema in
-- src/db/schema/documents.ts), plus the "document" kind of osbot_deliveries.
-- Apply after the migration that creates those tables. Everything is private:
-- the owner's rows only, no public policy of any kind.

-- ---------------------------------------------------------------------------
-- documents_documents
-- ---------------------------------------------------------------------------
create trigger documents_documents_set_updated_at
  before update on public.documents_documents
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.documents_documents enable row level security;
--> statement-breakpoint

create policy "documents: read own" on public.documents_documents for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "documents: insert own" on public.documents_documents for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "documents: update own" on public.documents_documents for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "documents: delete own" on public.documents_documents for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.documents_documents to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- documents_files (insert / delete only: a file is attached or it isn't)
--
-- The document side is a composite (owner_id, document_id) foreign key. The
-- file side is a plain foreign key to files_files(id), so the insert policy
-- also requires the file to be the viewer's own: foreign-key checks bypass
-- RLS, and without this a guessed id could link (and later cascade from)
-- someone else's file.
-- ---------------------------------------------------------------------------
alter table public.documents_files enable row level security;
--> statement-breakpoint

create policy "document files: read own" on public.documents_files for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "document files: insert own" on public.documents_files for insert to os_app
  with check (
    owner_id = app.current_user_id()
    and exists (
      select 1 from public.files_files f
      where f.id = file_id and f.owner_id = app.current_user_id()
    )
  );
--> statement-breakpoint
create policy "document files: delete own" on public.documents_files for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, delete on public.documents_files to os_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- osbot_deliveries: allow kind 'document' (expiry reminders).
--
-- The drizzle schema derives this CHECK from osbotDeliveryKinds, so the
-- generated table migration already rebuilds it. This block is the merge-safe
-- fallback: it adds 'document' to whatever kinds the constraint lists right
-- now (other branches add their own kinds the same way) and does nothing when
-- 'document' is already there. Idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  def text;
  kinds text[];
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conname = 'osbot_deliveries_kind_valid' and c.conrelid = 'public.osbot_deliveries'::regclass;

  if def is null then
    kinds := array['payment', 'weekly', 'budget-limit', 'monthly'];
  elsif def like '%''document''%' then
    return;
  else
    select array_agg(m[1] order by ord) into kinds
    from regexp_matches(def, '''([^'']+)''', 'g') with ordinality as t(m, ord);
  end if;

  kinds := array_append(kinds, 'document');
  execute 'alter table public.osbot_deliveries drop constraint if exists osbot_deliveries_kind_valid';
  execute format(
    'alter table public.osbot_deliveries add constraint osbot_deliveries_kind_valid check (kind in (%s))',
    (select string_agg(quote_literal(k), ', ') from unnest(kinds) as k)
  );
end
$$;
