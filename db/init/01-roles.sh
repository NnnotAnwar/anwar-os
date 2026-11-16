#!/bin/sh
# Runs once, when the data volume is first created (docker-entrypoint-initdb.d).
# os_app is the runtime role of the web app: it can log in, owns nothing, and
# cannot bypass row-level security. Migrations run as the superuser instead.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$OS_APP_PASSWORD" <<'SQL'
create role os_app login password :'app_password' nosuperuser nocreatedb nocreaterole nobypassrls;
grant connect on database anwar_os to os_app;
revoke create on schema public from public;
SQL
