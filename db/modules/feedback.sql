-- Module: feedback. Rate-limit errors say when the sender may try again.
-- Replaces app.submit_feedback() from 0006_feedback_rls.sql with the same
-- signature, checks and error codes; OS429 / OS430 now carry DETAIL = the
-- whole seconds until the oldest counted submission leaves its window, so the
-- form can show "Try again in 4:32" instead of "wait a few minutes".
-- `create or replace` keeps the existing grants (os_app execute only).
create or replace function app.submit_feedback(
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
  v_recent_oldest timestamptz;
  v_today_oldest timestamptz;
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

  select count(*) filter (where created_at > now() - interval '10 minutes'),
         count(*),
         min(created_at) filter (where created_at > now() - interval '10 minutes'),
         min(created_at)
    into v_recent, v_today, v_recent_oldest, v_today_oldest
    from public.feedback_submissions
   where ip_hash = p_ip_hash;

  if v_recent >= 3 then
    raise exception 'too many submissions in 10 minutes' using
      errcode = 'OS429',
      detail = greatest(1, ceil(extract(epoch from v_recent_oldest + interval '10 minutes' - now())))::text;
  end if;
  if v_today >= 20 then
    raise exception 'too many submissions today' using
      errcode = 'OS430',
      detail = greatest(1, ceil(extract(epoch from v_today_oldest + interval '1 day' - now())))::text;
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
