-- The public site shows the owner's published content (CV, public ideas, links)
-- to visitors who have no session. Policies for "published" rows scope them to
-- this user, so demo or future registered users' rows never appear publicly.
create function app.site_owner_id() returns text
language sql stable
set search_path = ''
as $$ select id from auth."user" where role = 'owner' order by created_at limit 1 $$;
--> statement-breakpoint

grant execute on function app.site_owner_id() to os_app;
