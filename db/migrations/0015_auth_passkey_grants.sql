-- Grants for auth.passkey (Better Auth passkey plugin). Like the other auth
-- tables there is no viewer while someone signs in, so no RLS: minimal grants.
--   select  list a user's passkeys; look a credential up while signing in
--   insert  register a passkey (Better Auth requires a fresh session)
--   update  only the label and the signature counter
--   delete  remove a passkey from Settings
-- public_key, credential_id and user_id can never be rewritten by the app.
grant select, insert, delete on auth.passkey to os_app;
--> statement-breakpoint
grant update (name, counter) on auth.passkey to os_app;
