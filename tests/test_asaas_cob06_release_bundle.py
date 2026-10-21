"""COB-06: prove candidate archive is content-addressed and not a deploy."""
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/validacao-pagamentos/asaas-cob06-empacotar-release-offline.py"


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )


class ReleaseBundleTest(unittest.TestCase):
    def test_checks_exactly_nine_sql_and_explicitly_no_deploy(self):
        result = run("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("9 SQL congelados", result.stdout)
        self.assertIn("SEM DEPLOY", result.stdout)

    def test_archive_is_reproducible_and_verifiable(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = pathlib.Path(tmp) / "release-a.zip"
            b = pathlib.Path(tmp) / "release-b.zip"
            for target in (a, b):
                result = run("--build", str(target))
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            verified = run("--verify", str(a))
            self.assertEqual(verified.returncode, 0, verified.stderr)
            with zipfile.ZipFile(a) as z:
                names = z.namelist()
                sql = [n for n in names if n.endswith(".sql") and n.startswith("supabase/")]
                self.assertEqual(len(sql), 9)
                self.assertFalse(any("staging-only" in n for n in names))
                self.assertFalse(any("catalogo-asaas-cob06-auditoria/" in n for n in names))
                self.assertIn("REVIEW-FIRST.txt", names)
                self.assertIn("supabase/functions/whatsapp-bot/index.ts", names)
                self.assertIn("supabase/functions/whatsapp-bot/storage-path-utils.mjs", names)
                self.assertIn("supabase/config.toml", names)
                self.assertIn("scripts/validacao-pagamentos/asaas-cob06-worker-producao-readonly.sql", names)
                self.assertNotIn("supabase/production-candidate/cob06_worker_webhook_producao_nao_implantar.sql", names)
                self.assertNotIn("supabase/functions/catalogo-asaas-financeiro/.env", names)

    def test_tampered_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = pathlib.Path(tmp) / "good.zip"
            bad = pathlib.Path(tmp) / "tampered.zip"
            self.assertEqual(run("--build", str(good)).returncode, 0)
            with zipfile.ZipFile(good) as original, zipfile.ZipFile(bad, "w") as altered:
                for info in original.infolist():
                    data = original.read(info.filename)
                    if info.filename == "pages/catalogo-admin.html":
                        data += b"<!-- modified -->"
                    altered.writestr(info, data)
            check = run("--verify", str(bad))
            self.assertNotEqual(check.returncode, 0)
            self.assertIn("hash de pages/catalogo-admin.html", check.stderr)

    def test_worker_readiness_is_read_only_and_runtime_config_reviewable(self):
        worker = (ROOT / "scripts/validacao-pagamentos/asaas-cob06-worker-producao-readonly.sql").read_text()
        config = (ROOT / "supabase/config.toml").read_text()
        self.assertIn("false AS producao_autorizada", worker)
        self.assertIn("false AS pagamentos_ativados_por_esta_consulta", worker)
        self.assertIn("guia-asaas-reconciliar-webhook", worker)
        self.assertIn("[functions.catalogo-asaas-financeiro]", config)
        self.assertRegex(config, r"(?s)\\[functions\\.catalogo-asaas-financeiro\\]\\s*verify_jwt\\s*=\\s*false")
        self.assertNotIn("SELECT cron.schedule(", worker)
        self.assertNotIn("CREATE TABLE", worker)

    def test_whatsapp_candidate_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = pathlib.Path(tmp) / "review-original.zip"
            tampered = pathlib.Path(tmp) / "review-whatsapp-tampered.zip"
            self.assertEqual(run("--build", str(original)).returncode, 0)
            with zipfile.ZipFile(original) as source, zipfile.ZipFile(tampered, "w") as dest:
                for item in source.infolist():
                    data = source.read(item.filename)
                    if item.filename == "supabase/functions/whatsapp-bot/index.ts":
                        data += b"// tampered candidate\n"
                    dest.writestr(item, data)
            result = run("--verify", str(tampered))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("hash de supabase/functions/whatsapp-bot/index.ts", result.stderr)

    def test_added_migration_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = pathlib.Path(tmp) / "good.zip"
            bad = pathlib.Path(tmp) / "extra.zip"
            self.assertEqual(run("--build", str(good)).returncode, 0)
            with zipfile.ZipFile(good) as original, zipfile.ZipFile(bad, "w") as altered:
                for info in original.infolist():
                    altered.writestr(info, original.read(info.filename))
                altered.writestr("supabase/staging-only/unsafe.sql", "SELECT 1;")
            check = run("--verify", str(bad))
            self.assertNotEqual(check.returncode, 0)
            self.assertIn("extras ou ausentes", check.stderr)


if __name__ == "__main__":
    unittest.main()
