-- Global search (⌘K and the phone search sheet): indexes for the columns the
-- module search providers match with `ilike '%query%'`, plus amounts.
--
-- pg_trgm GIN indexes serve infix ILIKE for queries of three or more
-- characters; shorter ones fall back to the (owner_id, ...) indexes. No new
-- tables, policies or grants: every search still runs as the viewer through
-- RLS. Idempotent, so it can be applied to a database that already has it
-- (db/tests/search.test.ts does exactly that).
--
-- Integrator: append as a migration after the table migrations. pg_trgm is a
-- trusted extension (Postgres 13+), and the migrator runs as the database owner.
create extension if not exists pg_trgm;
--> statement-breakpoint
create index if not exists notes_notes_title_trgm_idx on public.notes_notes using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists notes_notes_body_trgm_idx on public.notes_notes using gin (body gin_trgm_ops);
--> statement-breakpoint
create index if not exists tasks_tasks_title_trgm_idx on public.tasks_tasks using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists tasks_tasks_notes_trgm_idx on public.tasks_tasks using gin (notes gin_trgm_ops);
--> statement-breakpoint
create index if not exists inbox_items_text_trgm_idx on public.inbox_items using gin (text gin_trgm_ops);
--> statement-breakpoint
create index if not exists calendar_events_title_trgm_idx on public.calendar_events using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists calendar_events_notes_trgm_idx on public.calendar_events using gin (notes gin_trgm_ops);
--> statement-breakpoint
create index if not exists links_links_title_trgm_idx on public.links_links using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists links_links_url_trgm_idx on public.links_links using gin (url gin_trgm_ops);
--> statement-breakpoint
create index if not exists links_links_note_trgm_idx on public.links_links using gin (note gin_trgm_ops);
--> statement-breakpoint
create index if not exists ideas_ideas_title_trgm_idx on public.ideas_ideas using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists ideas_ideas_body_trgm_idx on public.ideas_ideas using gin (body gin_trgm_ops);
--> statement-breakpoint
create index if not exists projects_projects_title_trgm_idx on public.projects_projects using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists files_files_name_trgm_idx on public.files_files using gin (name gin_trgm_ops);
--> statement-breakpoint
create index if not exists files_documents_title_trgm_idx on public.files_documents using gin (title gin_trgm_ops);
--> statement-breakpoint
create index if not exists files_documents_body_trgm_idx on public.files_documents using gin (body gin_trgm_ops);
--> statement-breakpoint
create index if not exists feedback_items_message_trgm_idx on public.feedback_items using gin (message gin_trgm_ops);
--> statement-breakpoint
create index if not exists budget_transactions_note_trgm_idx on public.budget_transactions using gin (note gin_trgm_ops);
--> statement-breakpoint
-- "250" in search: abs(amount_minor) between 25000 and 25099, per owner.
create index if not exists budget_transactions_owner_abs_amount_idx on public.budget_transactions (owner_id, abs(amount_minor));
