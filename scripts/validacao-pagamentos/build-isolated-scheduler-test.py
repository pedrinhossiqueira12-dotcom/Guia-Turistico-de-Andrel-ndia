#!/usr/bin/env python3
"""Build a strictly isolated, non-networking copy of the legacy Cron/Vault migration.

NEVER run the original SQL on CI: it schedules an Edge Function on the live project.
This builder allows only the known migration shape, replaces the production URL
with an unresolvable .invalid domain, and removes extension installation commands.
A disposable test database provides inert cron and vault stubs. The resulting file
is TEMPORARY and must never be added to production migrations.
"""
from pathlib import Path
import re

SOURCE = Path(
    "supabase/migrations/"
    "20261002235010_schedule_storage_retention_dry_run_20261002.sql"
)
OUTPUT = Path("/tmp/catalogo-scheduler-no-network-ci.sql")

PRODUCTION_URL = (
    "https://xdmbkflufsfqziixzpxc.supabase.co/"
    "functions/v1/storage-cleanup"
)
TEST_URL = "https://ci-no-network.invalid/storage-cleanup"

EXPECTED_EXTENSIONS = (
    "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;",
    "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;",
)


def replace_exactly_once(sql: str, old: str, new: str) -> str:
    found = sql.count(old)
    if found != 1:
        raise RuntimeError(f"Unsafe scheduler migration change: expected one anchor, found {found}: {old[:90]}")
    return sql.replace(old, new, 1)


def build() -> str:
    sql = SOURCE.read_text(encoding="utf-8")

    required_once = (
        PRODUCTION_URL,
        "PERFORM vault.create_secret(",
        "PERFORM cron.schedule(",
        "PERFORM cron.unschedule(",
        "SELECT net.http_post(",
        "body := '{\"mode\":\"dry-run\"}'::jsonb",
        "CREATE OR REPLACE FUNCTION public.is_storage_cleanup_authorized(p_token text)",
        "REVOKE ALL ON FUNCTION public.is_storage_cleanup_authorized(text) FROM PUBLIC, anon, authenticated;",
        "GRANT EXECUTE ON FUNCTION public.is_storage_cleanup_authorized(text) TO service_role;",
    )
    for anchor in required_once:
        if sql.count(anchor) != 1:
            raise RuntimeError(f"Unsafe scheduler migration change: invalid count for {anchor[:90]}")

    # Reject any additional URLs or extension statements before modifying source.
    if re.findall(r"https?://[^'\s]+", sql) != [PRODUCTION_URL]:
        raise RuntimeError("Unexpected URL in scheduler migration; review it before testing")
    if len(re.findall(r"\bCREATE\s+EXTENSION\b", sql, flags=re.I)) != len(EXPECTED_EXTENSIONS):
        raise RuntimeError("Unexpected extension statement; review migration before running it")
    if sql.count("cron.schedule(") != 1 or sql.count("net.http_post(") != 1:
        raise RuntimeError("Additional cron schedule / HTTP call requires manual review")

    for statement in EXPECTED_EXTENSIONS:
        sql = replace_exactly_once(sql, statement, "-- CI: real extension omitted; inert cron/vault stubs used")

    sql = replace_exactly_once(sql, PRODUCTION_URL, TEST_URL)

    guard = """-- GENERATED CI COPY. NUNCA USAR EM PRODUCAO.
-- Cron schedule() is an inert SQL stub and this command is never executed.
DO $isolated_scheduler_guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_scheduler', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('cron.job') IS NULL
     OR to_regclass('vault.secrets') IS NULL
     OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_cron','pg_net'))
  THEN
    RAISE EXCEPTION 'Scheduler fixture exige catalogo_ci com cron/vault inertes e opt-in';
  END IF;
END $isolated_scheduler_guard$;
"""
    output = guard + "\n" + sql
    if "supabase.co" in output or PRODUCTION_URL in output:
        raise RuntimeError("Production Supabase URL survived sanitization")
    if re.search(r"\bCREATE\s+EXTENSION\b", output, re.I):
        # Comment string may say 'CREATE EXTENSION', so check executable statements only.
        raise RuntimeError("Extension installation survived scheduler sanitization")
    if output.count(TEST_URL) != 1 or output.count("PERFORM cron.schedule(") != 1:
        raise RuntimeError("Sanitized SQL does not have the expected inert job definition")
    OUTPUT.write_text(output, encoding="utf-8")
    return output


if __name__ == "__main__":
    sql = build()
    print(
        "PASS: generated scheduler migration copy without real extension installation "
        "or production URLs, for disposable PostgreSQL only"
    )
