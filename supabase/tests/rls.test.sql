-- RLS tests: run with `pnpm db:test` (supabase test db).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Two users; the provisioning trigger creates their profiles.
insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', false),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.local', false),
  ('00000000-0000-0000-0000-00000000000d', null, true);

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'user'::public.app_role, 'new email user is provisioned as user');
select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-00000000000d'),
  'demo'::public.app_role, 'anonymous user is provisioned as demo');

-- Act as Alice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ insert into public.notes_notes (title) values ('alice note') $$,
  'user can insert own note (owner_id defaults to auth.uid())');
select throws_ok(
  $$ insert into public.notes_notes (owner_id, title) values ('00000000-0000-0000-0000-00000000000b', 'forged') $$,
  '42501', null, 'user cannot insert a note for someone else');
select is((select count(*) from public.profiles)::int, 1, 'user sees only own profile');
select throws_ok(
  $$ update public.profiles set role = 'owner' $$,
  '42501', null, 'user cannot promote themselves');
select lives_ok(
  $$ update public.profiles set display_name = 'Alice' $$,
  'user can edit own preferences');

-- Act as Bob.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is((select count(*) from public.notes_notes)::int, 0, 'bob cannot see alice''s notes');
update public.notes_notes set title = 'hijacked';
delete from public.notes_notes;

-- Back to Alice: her note is untouched.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select title from public.notes_notes), 'alice note', 'bob could not update or delete alice''s note');
select throws_ok(
  $$ update public.notes_notes set owner_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'user cannot hand a note to someone else');

-- Anonymous (logged-out) visitors see nothing.
reset role;
set local role anon;
select throws_ok($$ select * from public.notes_notes $$, '42501', null, 'anon has no access to notes');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon has no access to profiles');

select * from finish();
rollback;
