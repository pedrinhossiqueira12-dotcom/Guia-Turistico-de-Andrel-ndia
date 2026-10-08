#!/usr/bin/env python3
"""Offline fail-closed regression tests for the financial migration release planner."""
import copy
import json
import runpy
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLAN = runpy.run_path(str(HERE / "build-release-migrations.py"))
validate = PLAN["validate_plan"]
prepare = PLAN["prepare"]
PreflightError = PLAN["PreflightError"]
MIGRATIONS = PLAN["MIGRATIONS"]
MANIFEST = PLAN["MANIFEST"]


class TestReleaseMigrations(unittest.TestCase):
    def test_remote_history_matches_all_local_files_except_one(self):
        result = validate()
        self.assertEqual(result["file_count"], 29)
        self.assertEqual(result["already_applied_count"], 28)
        self.assertEqual(result["pending_count"], 1)
        self.assertEqual(result["pending_release_version"], "20261008080000")
        self.assertEqual(
            sum(e["source"] != e["release"] for e in result["migrations"]), 4
        )
        self.assertEqual(sum(not e["remote_applied"] for e in result["migrations"]), 1)

    def test_package_byte_preserves_sql_and_has_single_pending_version(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-test-") as td:
            target = Path(td) / "prepared"
            evidence = validate()
            prepare(target, evidence)
            sql_files = list((target / "supabase" / "migrations").glob("*.sql"))
            self.assertEqual(len(sql_files), 29)
            file_names = {f.name for f in sql_files}
            self.assertIn("20261008080000_arredondamento_taxa_total_7.sql", file_names)
            self.assertNotIn("20261007213000_arredondamento_taxa_total_7.sql", file_names)
            self.assertIn("20261007233541_finalizar_regras_financeiras_e_offline.sql", file_names)
            for src, dst in evidence["mappings"].items():
                self.assertEqual(
                    (MIGRATIONS / src).read_bytes(),
                    (target / "supabase" / "migrations" / dst).read_bytes(),
                )
            out = json.loads((target / "release-evidence.json").read_text("utf-8"))
            self.assertEqual(out["pending_count"], 1)
            self.assertNotIn("mappings", out)
            self.assertIn("NAO AUTORIZA PRODUCAO", (target / "README.txt").read_text("utf-8"))

    def test_applied_sql_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-tamper-") as td:
            temp_migrations = Path(td) / "migrations"
            shutil.copytree(MIGRATIONS, temp_migrations)
            file = temp_migrations / "20261007190000_taxa_fixa_7_porcento.sql"
            file.write_bytes(file.read_bytes() + b"\n-- unexpected change\n")
            with self.assertRaisesRegex(PreflightError, "Already applied SQL changed"):
                validate(source=temp_migrations)

    def test_missing_migration_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-missing-") as td:
            temp_migrations = Path(td) / "migrations"
            shutil.copytree(MIGRATIONS, temp_migrations)
            (temp_migrations / "20261007213000_arredondamento_taxa_total_7.sql").unlink()
            with self.assertRaisesRegex(PreflightError, "Expected 29 SQL"):
                validate(source=temp_migrations)

    def test_invalid_or_stale_remote_history_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-history-") as td:
            modified = copy.deepcopy(json.loads(MANIFEST.read_text("utf-8")))
            modified["remote_versions"][-1] = modified["remote_versions"][-2]
            path = Path(td) / "manifest.json"
            path.write_text(json.dumps(modified), encoding="utf-8")
            with self.assertRaisesRegex(PreflightError, "28 distinct"):
                validate(manifest_path=path)

    def test_wrong_pending_version_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-order-") as td:
            modified = copy.deepcopy(json.loads(MANIFEST.read_text("utf-8")))
            modified["pending_migration"]["release"] = "20261007010000_arredondamento_taxa_total_7.sql"
            path = Path(td) / "manifest.json"
            path.write_text(json.dumps(modified), encoding="utf-8")
            with self.assertRaisesRegex(PreflightError, "strictly newer"):
                validate(manifest_path=path)

    def test_refuses_overwriting_release_directory(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-existing-") as td:
            with self.assertRaisesRegex(PreflightError, "Refusing to overwrite"):
                prepare(Path(td), validate())


if __name__ == "__main__":
    unittest.main(verbosity=2)
