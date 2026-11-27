#!/bin/bash
# Runs the role/permission test suite against a THROWAWAY local PostgreSQL 15+.
# Never point this at your Supabase project: it creates and drops databases.
#
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./supabase/tests/run_local_tests.sh
#
set -euo pipefail
cd "$(dirname "$0")"
M=../migrations
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists stl_test" -c "create database stl_test"
D="$P -d stl_test"
$D -f 00_supabase_stub.sql            # minimal auth schema + roles, like Supabase
$D -f $M/0001_schema.sql
$D -f $M/0002_security.sql
$D -f 10_seed_legacy.sql              # data that existed before the later migrations
$D -f $M/0003_daily_timesheet_leave_workflow.sql
$D -f $M/0004_leave_without_manager.sql
$D -f 20_seed_after_0004.sql
$D -f $M/0005_role_routing_history_projects.sql
$D -f 30_test_helpers.sql
$D -f 40_role_tests.sql
