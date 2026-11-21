-- auth.rate_limit: attempt counters (src/lib/rate-limit.ts). Like the other
-- auth tables it's used before there is a viewer, so no RLS; the app role gets
-- exactly the statements the limiter runs.
grant select, insert, update, delete on auth.rate_limit to os_app;
