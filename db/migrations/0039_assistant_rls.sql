-- Module: assistant (AI chat + the token log of every Claude call). Same-owner
-- foreign keys, triggers, row-level security and grants for the tables in
-- src/db/schema/assistant.ts. Apply after the drizzle migration that creates
-- the assistant_* tables. Conventions: docs/ARCHITECTURE.md §6.
--
-- Every row is private to its owner; nothing here is public.

-- ---------------------------------------------------------------------------
-- Same-owner references: a message (or a usage row) can only point at a
-- conversation of the same owner, even by a guessed id.
-- ---------------------------------------------------------------------------
alter table public.assistant_messages
  add constraint assistant_messages_conversation_fk foreign key (owner_id, conversation_id)
  references public.assistant_conversations (owner_id, id) on delete cascade;
--> statement-breakpoint
alter table public.assistant_usage
  add constraint assistant_usage_conversation_fk foreign key (owner_id, conversation_id)
  references public.assistant_conversations (owner_id, id) on delete set null (conversation_id);
--> statement-breakpoint
create index assistant_usage_conversation_idx on public.assistant_usage (owner_id, conversation_id);
--> statement-breakpoint

create trigger assistant_conversations_set_updated_at
  before update on public.assistant_conversations
  for each row execute function app.set_updated_at();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.assistant_conversations enable row level security;
--> statement-breakpoint
alter table public.assistant_messages enable row level security;
--> statement-breakpoint
alter table public.assistant_usage enable row level security;
--> statement-breakpoint

create policy "assistant conversations: own rows" on public.assistant_conversations for all to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- Messages are append-only: read, add, and gone with their conversation.
create policy "assistant messages: read own" on public.assistant_messages for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "assistant messages: insert own" on public.assistant_messages for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
-- Only the UI-side `meta` changes after insert (a confirm card's decision);
-- the column grant below keeps `content` untouchable.
create policy "assistant messages: update own" on public.assistant_messages for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

-- The usage log is a ledger: insert and read, never rewritten.
create policy "assistant usage: read own" on public.assistant_usage for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "assistant usage: insert own" on public.assistant_usage for insert to os_app
  with check (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, insert, update, delete on public.assistant_conversations to os_app;
--> statement-breakpoint
grant select, insert on public.assistant_messages to os_app;
--> statement-breakpoint
grant update (meta) on public.assistant_messages to os_app;
--> statement-breakpoint
grant select, insert on public.assistant_usage to os_app;
