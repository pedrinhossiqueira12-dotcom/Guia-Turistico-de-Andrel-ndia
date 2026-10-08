#!/usr/bin/env python3
"""Fail-closed tests for 29 remote migrations and one new courier withdrawal proposal."""
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
applied_sql_bytes = PLAN["applied_sql_bytes"]
PreflightError = PLAN["PreflightError"]
MIGRATIONS = PLAN["MIGRATIONS"]
MANIFEST = PLAN["MANIFEST"]


class TestReleaseMigrations(unittest.TestCase):
    def test_remote_history_has_exactly_one_new_withdrawal_migration(self):
        result = validate()
        self.assertEqual(result["file_count"], 30)
        self.assertEqual(result["already_applied_count"], 29)
        self.assertEqual(result["pending_count"], 1)
        self.assertEqual(result["pending_release_version"], "20261008160000")
        self.assertEqual(sum(e["source"] != e["release"] for e in result["migrations"]), 4)
        self.assertEqual(sum(not e["remote_applied"] for e in result["migrations"]), 1)

    def test_package_uses_real_remote_versions_and_correct_final_sql(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-test-") as td:
            target = Path(td) / "prepared"
            evidence = validate()
            prepare(target, evidence)
            remote = target / "supabase" / "migrations"
            names = {p.name for p in remote.glob("*.sql")}
            self.assertEqual(len(names), 30)
            self.assertIn("20261008160000_saques_motoboy_mensais_v2.sql", names)
            final_name = "20261008120906_arredondamento_taxa_total_7_outubro_2026.sql"
            self.assertIn(final_name, names)
            self.assertNotIn("20261007213000_arredondamento_taxa_total_7.sql", names)
            for src, dst in evidence["mappings"].items():
                expected = (MIGRATIONS / src).read_bytes()
                if src == evidence["normalized_local"]:
                    expected = applied_sql_bytes(expected)
                self.assertEqual(expected, (remote / dst).read_bytes())
            out = json.loads((target / "release-evidence.json").read_text("utf-8"))
            self.assertEqual(out["pending_count"], 1)
            self.assertNotIn("normalized_local", out)
            self.assertIn("UMA MIGRATION DE SAQUE PENDENTE", (target / "README.txt").read_text("utf-8"))

    def test_applied_sql_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-tamper-") as td:
            source = Path(td) / "migrations"
            shutil.copytree(MIGRATIONS, source)
            p = source / "20261007190000_taxa_fixa_7_porcento.sql"
            p.write_bytes(p.read_bytes() + b"\n-- changed\n")
            with self.assertRaisesRegex(PreflightError, "Already applied SQL changed"):
                validate(source=source)

    def test_final_sql_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-final-") as td:
            source = Path(td) / "migrations"
            shutil.copytree(MIGRATIONS, source)
            p = source / "20261007213000_arredondamento_taxa_total_7.sql"
            original = p.read_bytes()
            self.assertIn(b"\nCOMMIT;\n", original)
            p.write_bytes(original.replace(b"\nCOMMIT;\n", b"\n-- changed\nCOMMIT;\n"))
            with self.assertRaisesRegex(PreflightError, "Applied final SQL changed"):
                validate(source=source)

    def test_missing_migration_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-missing-") as td:
            source = Path(td) / "migrations"
            shutil.copytree(MIGRATIONS, source)
            (source / "20261007213000_arredondamento_taxa_total_7.sql").unlink()
            with self.assertRaisesRegex(PreflightError, "Missing final SQL"):
                validate(source=source)

    def test_invalid_or_stale_remote_history_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-history-") as td:
            modified = copy.deepcopy(json.loads(MANIFEST.read_text("utf-8")))
            modified["remote_versions"][-1] = modified["remote_versions"][-2]
            path = Path(td) / "manifest.json"
            path.write_text(json.dumps(modified), encoding="utf-8")
            with self.assertRaisesRegex(PreflightError, "29 distinct"):
                validate(manifest_path=path)

    def test_stale_manifest_with_pending_blocked(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-pending-") as td:
            modified = copy.deepcopy(json.loads(MANIFEST.read_text("utf-8")))
            modified["pending_migration"] = {
                "local": "20261007213000_arredondamento_taxa_total_7.sql",
                "release": "20261008080000_arredondamento_taxa_total_7.sql"
            }
            path = Path(td) / "manifest.json"
            path.write_text(json.dumps(modified), encoding="utf-8")
            with self.assertRaisesRegex(PreflightError, "Exactly one new courier withdrawal"):
                validate(manifest_path=path)

    def test_refuses_overwriting_release_directory(self):
        with tempfile.TemporaryDirectory(prefix="catalogo-release-existing-") as td:
            with self.assertRaisesRegex(PreflightError, "Refusing to overwrite"):
                prepare(Path(td), validate())


if __name__ == "__main__":
    unittest.main(verbosity=2)
