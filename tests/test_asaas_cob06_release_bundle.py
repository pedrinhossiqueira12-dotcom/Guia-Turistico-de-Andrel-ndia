"""COB-06: prove candidate archive is content-addressed and not a deploy."""
import pathlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
import importlib.util
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/validacao-pagamentos/asaas-cob06-empacotar-release-offline.py"


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )


class ReleaseBundleTest(unittest.TestCase):
    def test_audit_fourteen_is_explicit_reproducible_and_preserves_originals(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = (pathlib.Path(tmp) / n for n in ("audit-a.zip", "audit-b.zip"))
            for dest in (a, b):
                built = run("--profile", "audit-14", "--build", str(dest))
                self.assertEqual(built.returncode, 0, built.stderr)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(run("--profile", "audit-14", "--verify", str(a)).returncode, 0)
            self.assertNotEqual(run("--verify", str(a)).returncode, 0)
            with zipfile.ZipFile(a) as z:
                m = json.loads(z.read("RELEASE-REVIEW-MANIFEST.json"))
                original = json.loads((ROOT / "scripts/validacao-pagamentos/asaas-cob06-billing-only.lock.json").read_bytes())
                self.assertEqual(m["sql_count"], 14)
                self.assertEqual(m["contract"], "COB-06-audit-14-review")
                self.assertEqual(m["sql_execution_order"][:9], [f["path"] for f in original["files"]])
                self.assertEqual(len([p for p in z.namelist() if p.startswith("supabase/") and p.endswith(".sql")]), 14)
                for entry in original["files"]:
                    self.assertEqual(z.read(entry["path"]), (ROOT / entry["path"]).read_bytes())
                for source in ("catalogo-fatura-pix/index.ts", "catalogo-fatura-pix/fatura-utils.mjs",
                               "catalogo-pedidos-offline-admin/index.ts"):
                    self.assertIn("supabase/functions/" + source, z.namelist())
                self.assertIn(b"AUDIT-14 REVIEW / HOLD", z.read("REVIEW-FIRST.txt"))
                self.assertFalse(any("staging-only" in p or "somente_ci.sql" in p for p in z.namelist()))

    def test_audit_rejects_missing_tampered_and_extra_dependencies(self):
        targets = ("supabase/production-candidate/cob06-auditoria-02-emissao.sql",
                   "supabase/functions/catalogo-fatura-pix/index.ts",
                   "supabase/functions/catalogo-pedidos-offline-admin/index.ts",
                   "scripts/validacao-pagamentos/asaas-cob06-auditoria-review.lock.json")
        with tempfile.TemporaryDirectory() as tmp:
            good, bad = (pathlib.Path(tmp) / n for n in ("good.zip", "bad.zip"))
            self.assertEqual(run("--profile", "audit-14", "--build", str(good)).returncode, 0)
            for target in targets:
                for omit in (True, False):
                    with self.subTest(target=target, omit=omit):
                        with zipfile.ZipFile(good) as src, zipfile.ZipFile(bad, "w") as dst:
                            for item in src.infolist():
                                if omit and item.filename == target:
                                    continue
                                data = src.read(item.filename)
                                dst.writestr(item, data + b"tampered" if item.filename == target else data)
                        self.assertNotEqual(run("--profile", "audit-14", "--verify", str(bad)).returncode, 0)
            with zipfile.ZipFile(good) as src, zipfile.ZipFile(bad, "w") as dst:
                for item in src.infolist():
                    dst.writestr(item, src.read(item.filename))
                dst.writestr("supabase/production-candidate/11_cob06_quitacao_atomica_somente_ci.sql", "SELECT 1;")
            self.assertNotEqual(run("--profile", "audit-14", "--verify", str(bad)).returncode, 0)

    def test_audit_lock_rejects_reorder_content_change_and_base_lock_change(self):
        spec = importlib.util.spec_from_file_location("review_bundle", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        get = module.get
        baseline = json.loads(get(module.AUDIT_LOCK))
        for mode in ("order", "base", "content", "extra"):
            candidate = json.loads(json.dumps(baseline))
            if mode == "order":
                candidate["files"].reverse()
            elif mode == "base":
                candidate["base_lock_sha256"] = "0" * 64
            elif mode == "extra":
                candidate["files"].append(candidate["files"][0])
            def altered(path):
                if path == module.AUDIT_LOCK:
                    return json.dumps(candidate).encode()
                data = get(path)
                return data + b"\n-- altered\n" if mode == "content" and path == module.AUDIT_SQL[0] else data
            with self.subTest(mode=mode), patch.object(module, "get", altered):
                with self.assertRaises(module.Blocked):
                    module.inventory(True)

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
                self.assertIn("pages/admin-encerramentos.html", names)
                self.assertIn("js/admin-encerramentos.js", names)
                for dependency in ("js/index.js", "js/local.js",
                                   "pages/termos-comercios.html", "pages/politica-privacidade.html"):
                    self.assertIn(dependency, names)
                manifest = json.loads(z.read("RELEASE-REVIEW-MANIFEST.json"))
                groups = manifest["ui_review_groups"]
                self.assertEqual(groups["publication_and_direct_link"], ["js/index.js", "js/local.js"])
                self.assertEqual(groups["merchant_terms_and_privacy"],
                                 ["pages/termos-comercios.html", "pages/politica-privacidade.html"])
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

    def test_financial_admin_view_must_be_reviewed_and_tamper_evident(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = pathlib.Path(tmp) / "review-original.zip"
            tampered = pathlib.Path(tmp) / "review-admin-tampered.zip"
            self.assertEqual(run("--build", str(original)).returncode, 0)
            with zipfile.ZipFile(original) as source, zipfile.ZipFile(tampered, "w") as dest:
                for item in source.infolist():
                    data = source.read(item.filename)
                    if item.filename == "js/admin-encerramentos.js":
                        data += b"// tampered admin\n"
                    dest.writestr(item, data)
            result = run("--verify", str(tampered))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("hash de js/admin-encerramentos.js", result.stderr)

    def test_worker_readiness_is_read_only_and_runtime_config_reviewable(self):
        worker = (ROOT / "scripts/validacao-pagamentos/asaas-cob06-worker-producao-readonly.sql").read_text()
        config = (ROOT / "supabase/config.toml").read_text()
        self.assertIn("false AS producao_autorizada", worker)
        self.assertIn("false AS pagamentos_ativados_por_esta_consulta", worker)
        self.assertIn("guia-asaas-reconciliar-webhook", worker)
        self.assertIn("[functions.catalogo-asaas-financeiro]", config)
        self.assertRegex(config, r"(?s)\[functions\.catalogo-asaas-financeiro\]\s*verify_jwt\s*=\s*false")
        self.assertRegex(config, r"(?s)\[functions\.whatsapp-bot\]\s*verify_jwt\s*=\s*false")
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

    def test_publication_and_legal_dependencies_cannot_be_removed_or_tampered(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = pathlib.Path(tmp) / "good.zip"
            self.assertEqual(run("--build", str(good)).returncode, 0)
            for dependency in ("js/index.js", "js/local.js",
                               "pages/termos-comercios.html", "pages/politica-privacidade.html"):
                for omit in (False, True):
                    with self.subTest(dependency=dependency, omit=omit):
                        bad = pathlib.Path(tmp) / "bad.zip"
                        with zipfile.ZipFile(good) as original, zipfile.ZipFile(bad, "w") as altered:
                            for info in original.infolist():
                                if omit and info.filename == dependency:
                                    continue
                                content = original.read(info.filename)
                                if info.filename == dependency:
                                    content += b"\nmodified\n"
                                altered.writestr(info, content)
                        checked = run("--verify", str(bad))
                        self.assertNotEqual(checked.returncode, 0)
                        self.assertIn("extras ou ausentes" if omit else "hash de " + dependency,
                                      checked.stderr)


if __name__ == "__main__":
    unittest.main()
