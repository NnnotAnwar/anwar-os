-- Module: feedback (contact form). Trigger, row-level security, grants and the
-- contact form's one anonymous write path. Apply after the migration that
-- creates contact_messages / contact_submissions (src/db/schema/feedback.ts).
-- Mirrors db/migrations/0006_feedback_rls.sql + 0022_feedback_retry_after.sql.

create trigger contact_messages_set_updated_at
  before update on public.contact_messages
  for each row execute function app.set_updated_at();
--> statement-breakpoint

alter table public.contact_messages enable row level security;
--> statement-breakpoint
-- Rate-limit and replay log: RLS on, no policies, no grants. Only
-- app.submit_contact() (security definer) touches it.
alter table public.contact_submissions enable row level security;
--> statement-breakpoint
revoke all on public.contact_submissions from os_app;
--> statement-breakpoint

-- Messages belong to whoever they were addressed to (the site owner). No
-- insert policy and no INSERT grant: they only arrive through app.submit_contact().
create policy "contact: read own" on public.contact_messages for select to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "contact: update own" on public.contact_messages for update to os_app
  using (owner_id = app.current_user_id())
  with check (owner_id = app.current_user_id());
--> statement-breakpoint
create policy "contact: delete own" on public.contact_messages for delete to os_app
  using (owner_id = app.current_user_id());
--> statement-breakpoint

grant select, delete on public.contact_messages to os_app;
--> statement-breakpoint
-- The sender's words are never editable; the owner only triages. alerted_at is
-- set by the osbot API (and the web's direct notify) once the owner was told.
grant update (status, alerted_at) on public.contact_messages to os_app;
--> statement-breakpoint

-- Public submission. Runs as the function owner (the migration role): it
-- validates every argument itself, holds a per-sender lock, enforces 3 per 10
-- minutes and 10 per day per IP hash, refuses a reused form token, files the
-- message for the site owner, and deletes the owner's archived messages older
-- than 12 months (the retention the form promises). Error codes:
--   22023 invalid argument · OS001 no site owner · OS409 token reused
--   OS429 too many in 10 minutes · OS430 too many today (DETAIL = seconds to wait)
create function app.submit_contact(
  p_topic text,
  p_name text,
  p_email text,
  p_company text,
  p_message text,
  p_ip_hash text,
  p_token text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
  v_message text := btrim(coalesce(p_message, ''));
  v_recent integer;
  v_today integer;
  v_recent_oldest timestamptz;
  v_today_oldest timestamptz;
  v_inserted integer;
  v_id uuid;
begin
  if p_topic is null or p_topic not in ('job', 'freelance', 'other') then
    raise exception 'topic must be job, freelance or other' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'name must be 1 to 100 characters' using errcode = '22023';
  end if;
  if char_length(v_email) not between 3 and 200 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'email must be a valid address' using errcode = '22023';
  end if;
  if char_length(v_company) > 120 then
    raise exception 'company must be at most 120 characters' using errcode = '22023';
  end if;
  if char_length(v_message) not between 10 and 5000 then
    raise exception 'message must be 10 to 5000 characters' using errcode = '22023';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'ip hash must be a hex SHA-256' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) not between 16 and 200 then
    raise exception 'form token is missing' using errcode = '22023';
  end if;

  v_owner := app.site_owner_id();
  if v_owner is null then
    raise exception 'there is no site owner to receive messages' using errcode = 'OS001';
  end if;

  -- Serialize submissions from one sender so parallel requests can't all pass
  -- the count below.
  perform pg_advisory_xact_lock(hashtextextended('contact:' || p_ip_hash, 0));

  delete from public.contact_submissions where created_at < now() - interval '1 day';
  delete from public.contact_messages
   where owner_id = v_owner and status = 'archived' and updated_at < now() - interval '12 months';

  select count(*) filter (where created_at > now() - interval '10 minutes'),
         count(*),
         min(created_at) filter (where created_at > now() - interval '10 minutes'),
         min(created_at)
    into v_recent, v_today, v_recent_oldest, v_today_oldest
    from public.contact_submissions
   where ip_hash = p_ip_hash;

  if v_recent >= 3 then
    raise exception 'too many messages in 10 minutes' using
      errcode = 'OS429',
      detail = greatest(1, ceil(extract(epoch from v_recent_oldest + interval '10 minutes' - now())))::text;
  end if;
  if v_today >= 10 then
    raise exception 'too many messages today' using
      errcode = 'OS430',
      detail = greatest(1, ceil(extract(epoch from v_today_oldest + interval '1 day' - now())))::text;
  end if;

  insert into public.contact_submissions (token, ip_hash)
  values (p_token, p_ip_hash)
  on conflict (token) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'this form token was already used' using errcode = 'OS409';
  end if;

  insert into public.contact_messages (owner_id, topic, name, email, company, message)
  values (v_owner, p_topic, v_name, v_email, v_company, v_message)
  returning id into v_id;

  return v_id;
end;
$$;
--> statement-breakpoint

revoke execute on function app.submit_contact(text, text, text, text, text, text, text) from public;
--> statement-breakpoint
grant execute on function app.submit_contact(text, text, text, text, text, text, text) to os_app;
