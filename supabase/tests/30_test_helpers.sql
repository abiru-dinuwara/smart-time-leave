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

create schema if not exists test;
create table if not exists test.results (n serial, name text, pass boolean, detail text);
grant usage on schema test to authenticated;
grant insert, select on test.results to authenticated;
grant usage on sequence test.results_n_seq to authenticated;

create or replace function test.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false)
$$;

create or replace function test.ok(p_name text, p_cond boolean, p_detail text default '') returns void
language sql as $$ insert into test.results(name, pass, detail) values (p_name, coalesce(p_cond, false), p_detail) $$;

-- statement must fail and the message must match the pattern (case-insensitive)
create or replace function test.err(p_name text, p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into test.results(name, pass, detail) values (p_name, sqlerrm ~* p_pattern, sqlerrm);
    return;
  end;
  insert into test.results(name, pass, detail) values (p_name, false, 'expected an error, none raised');
end $$;

-- statement must succeed
create or replace function test.noerr(p_name text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into test.results(name, pass, detail) values (p_name, true, '');
exception when others then
  insert into test.results(name, pass, detail) values (p_name, false, sqlerrm);
end $$;

grant execute on all functions in schema test to authenticated;
create or replace function test.logout() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', false)
$$;
grant execute on function test.logout() to authenticated;
