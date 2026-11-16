-- Module: feedback. Trigger, row-level security, grants and the one anonymous
-- write path of the site. Apply after the migration that creates the tables
-- (drizzle schema in src/db/schema/feedback.ts) and after app.site_owner_id().

create trigger feedback_items_set_updated_at
  before update on public.feedback_items
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.feedback_items enable row level security;
--> statement-breakpoint
-- Rate-limit and replay log: RLS on, no policies, no grants. Only
-- app.submit_feedback() (security definer) touches it.
alter table public.feedback_submissions enable row level security;
--> statement-breakpoint
revoke all on public.feedback_submissions from os_app;
--> statement-breakpoint

-- The inbox belongs to whoever it was addressed to (the site owner). There is
-- deliberately no insert policy and no INSERT grant: submissions only arrive
-- through app.submit_feedback().
create policy "feedback: read own" on public.feedback_items for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "feedback: update own" on public.feedback_items for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "feedback: delete own" on public.feedback_items for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, delete on public.feedback_items to os_app;
--> statement-breakpoint
-- The sender's words are never editable; the owner only triages and annotates.
grant update (status, reply_note) on public.feedback_items to os_app;
--> statement-breakpoint

-- Anonymous submission. Runs as the function owner (the migration role), so it
-- can write rows nobody else can: it validates every argument itself, holds a
-- per-sender lock, enforces 3 per 10 minutes and 20 per day per IP hash,
-- refuses a reused proof-of-work challenge, and files the item for the site
-- owner. Error codes the app maps to messages:
--   22023 invalid argument · OS001 no site owner · OS409 challenge reused
--   OS429 too many in 10 minutes · OS430 too many today
create function app.submit_feedback(
  p_kind text,
  p_message text,
  p_name text,
  p_contact text,
  p_ip_hash text,
  p_challenge text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_message text := btrim(coalesce(p_message, ''));
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
  v_recent integer;
  v_today integer;
  v_inserted integer;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('complaint', 'suggestion', 'question', 'thanks') then
    raise exception 'kind must be complaint, suggestion, question or thanks' using errcode = '22023';
  end if;
  if char_length(v_message) not between 10 and 5000 then
    raise exception 'message must be 10 to 5000 characters' using errcode = '22023';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'name must be at most 100 characters' using errcode = '22023';
  end if;
  if char_length(v_contact) > 200 then
    raise exception 'contact must be at most 200 characters' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip hash must be a hex SHA-256' using errcode = '22023';
  end if;
  if p_challenge is null or char_length(p_challenge) not between 16 and 200 then
    raise exception 'challenge is missing' using errcode = '22023';
  end if;

  v_owner := app.site_owner_id();
  if v_owner is null then
    raise exception 'there is no site owner to receive feedback' using errcode = 'OS001';
  end if;

  -- Serialize submissions from one sender so parallel requests can't all pass
  -- the count below.
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || p_ip_hash, 0));

  delete from public.feedback_submissions where created_at < now() - interval '1 day';

  select count(*) filter (where created_at > now() - interval '10 minutes'), count(*)
    into v_recent, v_today
    from public.feedback_submissions
   where ip_hash = p_ip_hash;

  if v_recent >= 3 then
    raise exception 'too many submissions in 10 minutes' using errcode = 'OS429';
  end if;
  if v_today >= 20 then
    raise exception 'too many submissions today' using errcode = 'OS430';
  end if;

  insert into public.feedback_submissions (challenge, ip_hash)
  values (p_challenge, p_ip_hash)
  on conflict (challenge) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'this challenge was already used' using errcode = 'OS409';
  end if;

  insert into public.feedback_items (owner_id, kind, message, name, contact)
  values (v_owner, p_kind, v_message, v_name, v_contact)
  returning id into v_id;

  return v_id;
end;
$$;
--> statement-breakpoint

revoke execute on function app.submit_feedback(text, text, text, text, text, text) from public;
--> statement-breakpoint
grant execute on function app.submit_feedback(text, text, text, text, text, text) to os_app;
