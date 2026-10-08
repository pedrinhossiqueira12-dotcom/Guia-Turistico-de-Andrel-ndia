#!/usr/bin/env python3
"""Build an ephemeral LOCAL-ONLY Supabase workspace for native pgTAP testing.

NEVER run the migrations from this script against a remote database.
The workspace is generated under /tmp and is never committed/deployed.
The original Cron/Vault migration contains a production URL: replace that
whole migration with an explicit no-op *in the temporary CI copy only*.
Legacy baseline and fictional test business are temporary local migrations.
No user/order/payment rows or credentials are copied from production.
"""
from pathlib import Path
import os
import re
import shutil

SOURCE = Path("supabase")
STAGING = Path("/tmp/guia-supabase-native-ci")
LEGACY_FILE = SOURCE / "tests/baseline/legacy-public-tables.sql"
ORIGINAL_SCHEDULER = "20261002235010_schedule_storage_retention_dry_run_20261002.sql"
ALLOWLIST = "20261005133000_catalogo_marketplace_test_allowlist.sql"
BASELINE = "20261002233000_ci_legacy_public_baseline.sql"
ALLOWLIST_SEED = "20261005132500_ci_allowlist_seed.sql"
NATIVE_TEST = "marketplace_financeiro_v2.test.sql"
FIXTURE_USER = "00000000-0000-4000-8000-000000000099"

def fail_if_untrusted():
    if os.environ.get("SUPABASE_ACCESS_TOKEN") or os.environ.get("SUPABASE_DB_PASSWORD"):
        raise RuntimeError("Native local test must not inherit a Supabase cloud access token")
    if os.environ.get("DATABASE_URL") or os.environ.get("PGSERVICE"):
        raise RuntimeError("Native local test refuses an external PostgreSQL connection")
    if not LEGACY_FILE.is_file() or not (SOURCE / "migrations" / ORIGINAL_SCHEDULER).is_file():
        raise RuntimeError("Expected actual migrations and synthetic baseline missing")
    if STAGING == Path("/") or STAGING.parent != Path("/tmp"):
        raise RuntimeError("Unsafe temporary staging directory")
    migration_files = sorted((SOURCE / "migrations").glob("*.sql"))
    if len(migration_files) != 30 or migration_files[1].name != ORIGINAL_SCHEDULER or migration_files[-1].name != "20261008150000_solicitacao_saque_mensal_motoboy.sql":
        raise RuntimeError("Migration inventory changed, manual review required")
    if not (SOURCE / "migrations" / ALLOWLIST).is_file():
        raise RuntimeError("Allowlist migration missing")
    return migration_files

def build():
    migrations = fail_if_untrusted()
    if STAGING.exists():
        shutil.rmtree(STAGING)
    migration_dir = STAGING / "supabase/migrations"
    tests_dir = STAGING / "supabase/tests/database"
    migration_dir.mkdir(parents=True)
    tests_dir.mkdir(parents=True)

    # Crucial: original config.toml references the REAL Supabase project.
    # Never copy it, auth tokens, .temp, .branches or .env into this project.
    (STAGING / "supabase/config.toml").write_text(
        'project_id = "guia-andrelandia-native-ci-isolado"\n'
        '[db]\n'
        'major_version = 17\n'
        '[db.seed]\n'
        'enabled = false\n',
        encoding="utf-8",
    )

    base = LEGACY_FILE.read_text(encoding="utf-8")
    expected = "current_database() <> 'catalogo_ci'"
    if base.count(expected) != 1:
        raise RuntimeError("Legacy fixture DB guard unexpectedly changed")
    if base.count("current_setting('app.marketplace_test_baseline', true)") != 1:
        raise RuntimeError("Legacy fixture opt-in unexpectedly changed")
    base = base.replace(expected, "current_database() <> 'postgres'", 1)
    (migration_dir / BASELINE).write_text(
        "-- CI ONLY. The original legacy fixture is tested unchanged in catalogo_ci.\n"
        "-- In this temporary Supabase local database, the DB name is postgres.\n"
        "SET app.marketplace_test_baseline = 'enabled';\n" + base,
        encoding="utf-8",
    )

    for source in migrations:
        target = migration_dir / source.name
        sql = source.read_text(encoding="utf-8")
        if source.name == ORIGINAL_SCHEDULER:
            if sql.count("https://xdmbkflufsfqziixzpxc.supabase.co") != 1:
                raise RuntimeError("Unsafe scheduled migration change: inspect it before proceeding")
            target.write_text(
                "-- CI NO-OP: deliberately omits actual pg_cron/pg_net/Vault schedule.\n"
                "-- The real scheduler logic is independently validated with inert stubs.\n"
                "DO $ci_skip_external_schedule$ BEGIN\n"
                "  IF current_database() <> 'postgres' THEN\n"
                "    RAISE EXCEPTION 'Native CI scheduler placeholder is local only';\n"
                "  END IF;\n"
                "END $ci_skip_external_schedule$;\n",
                encoding="utf-8",
            )
            continue
        if re.search(r"https?://xdmbkflufsfqziixzpxc\.supabase\.co", sql):
            raise RuntimeError(f"Production project endpoint present in {source.name}")
        target.write_text(sql, encoding="utf-8")

    (migration_dir / ALLOWLIST_SEED).write_text(
        "-- CI ONLY: synthetic commerce required by historical allowlist INSERT.\n"
        "DO $ci_seed_guard$ BEGIN\n"
        "  IF current_database() <> 'postgres' OR to_regclass('public.catalogos') IS NULL\n"
        "     OR EXISTS(SELECT 1 FROM public.catalogo_pedidos) THEN\n"
        "    RAISE EXCEPTION 'Native CI seed requires disposable empty catalog database';\n"
        "  END IF;\n"
        "END $ci_seed_guard$;\n"
        f"INSERT INTO auth.users (id) VALUES ('{FIXTURE_USER}');\n"
        "INSERT INTO public.comercios_publicados(local_id,status,destaque)\n"
        "  VALUES('comercio-de-exemplo','ativo',false);\n"
        "INSERT INTO public.catalogos(comercio_id,proprietario_id)\n"
        f"  VALUES('comercio-de-exemplo','{FIXTURE_USER}');\n",
        encoding="utf-8",
    )

    real_test = (SOURCE / "tests/database" / NATIVE_TEST).read_text(encoding="utf-8")
    if real_test.count("select plan(23)") != 1:
        raise RuntimeError("Native pgTAP count changed; inspect it before running")
    if not real_test.strip().endswith("rollback;"):
        raise RuntimeError("Native pgTAP regression lacks ROLLBACK")
    # In the isolated local stack, pgTAP is installed in the extensions schema.
    real_test = real_test.replace(
        "begin;\n",
        "begin;\nCREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;\n"
        "SET LOCAL search_path = public, extensions;\n",
        1,
    )
    (tests_dir / NATIVE_TEST).write_text(real_test, encoding="utf-8")

    staged = sorted(migration_dir.glob("*.sql"))
    if len(staged) != 32:
        raise RuntimeError(f"Expected 31 temporary migrations, got {len(staged)}")
    assert staged[0].name == BASELINE
    assert staged[-1].name == migrations[-1].name
    assert sorted(migration_dir.glob("*" + "schedule_storage_retention_dry_run_20261002.sql"))
    if "xdmbkflufsfqziixzpxc" in "".join(
        file.read_text(encoding="utf-8") for file in staged
    ):
        raise RuntimeError("Real project ref survived in generated migration SQL")
    print(
        "PASS: 31 temporary migration files in /tmp, 28 untouched real migrations, "
        "one safe scheduling placeholder, two synthetic-only fixtures; "
        "local project ID differs from production"
    )

if __name__ == "__main__":
    build()
