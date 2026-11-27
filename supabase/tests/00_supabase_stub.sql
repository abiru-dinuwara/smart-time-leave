-- =====================================================================
-- LOCAL TEST FILE — DO NOT RUN IN SUPABASE.
-- Run only through run_local_tests.sh against a throwaway local PostgreSQL.
-- It creates fake users, changes roles and deletes data.
-- To check your real Supabase database, use verify_0005_supabase.sql instead.
-- =====================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin'))
     or exists (select 1 from pg_namespace where nspname in ('storage', 'realtime', 'supabase_functions')) then
    raise exception 'STOP: this is a local test file and must not run on a Supabase project. Use supabase/tests/verify_0005_supabase.sql instead.';
  end if;
end $guard$;

-- Minimal stand-in for the parts of Supabase the migrations rely on.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to postgres;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated, public;
