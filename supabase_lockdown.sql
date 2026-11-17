-- Run ONCE in the Supabase SQL editor after loading the data (node load.mjs) and auth.sql.
--
-- Supabase exposes the public schema through an HTTP API that anyone with the project's public (anon) key can call.
-- This app reads the database only from its own server (as the owner role), so the public API must see nothing.
-- Row-level security with no policies = no rows for anon/authenticated; the owner role used by the app bypasses it.
alter table managers             enable row level security;
alter table artists              enable row level security;
alter table clients              enable row level security;
alter table revenue_lines        enable row level security;
alter table manager_settlements  enable row level security;
alter table app_users            enable row level security;
alter table user_artists         enable row level security;

-- Views ignore the RLS of the tables underneath, so take their public access away explicitly.
revoke all on v_revenue from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Check: this should return no rows.
-- select table_name, privilege_type from information_schema.role_table_grants
--  where grantee in ('anon','authenticated') and table_schema = 'public';
