#!/usr/bin/env python3
"""COB-06: artefato de REVISAO offline, never deploys or contacts any service.

The SQL selection is locked to nine immutable git blobs.  Source modules and
UI files are copied for review, not installed or promoted automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "scripts/validacao-pagamentos/asaas-cob06-billing-only.lock.json"
SQL = (
    "supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql",
    "supabase/production-candidate/02_termos_encerramento_sem_saques.sql",
    "supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql",
    "supabase/pending-migrations/20261009163000_impedir_reabertura_encerramento.sql",
    "supabase/pending-migrations/20261009180000_status_publicacao_publica_restrita.sql",
    "supabase/pending-migrations/20261009183000_proteger_republicacao_legada_apos_encerramento.sql",
    "supabase/pending-migrations/20261009184000_bloquear_despublicacao_legada_qualquer_status.sql",
    "supabase/pending-migrations/20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql",
    "supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql",
)
EDGE = "supabase/functions/catalogo-asaas-financeiro/index.ts"
WHATSAPP_EDGE = "supabase/functions/whatsapp-bot/index.ts"
WHATSAPP_HELPER = "supabase/functions/whatsapp-bot/storage-path-utils.mjs"
UI = ("pages/catalogo-admin.html", "js/catalogo-admin.js")
# Does not include any staging-only migrations, QA routes or payout modules as entrypoints.
DOCUMENTATION = (
    "docs/ASAAS_COB06_PACOTE_MINIMO_CANDIDATO_20261012.md",
    "scripts/validacao-pagamentos/asaas-cob06-seguranca-readonly.sql",
    "scripts/validacao-pagamentos/asaas-producao-readiness-readonly.sql",
    "scripts/validacao-pagamentos/asaas-cob06-worker-producao-readonly.sql",
    "supabase/config.toml",
)
SOURCE_IMPORT = re.compile(r'\bfrom\s*["\'](\.[^"\']+)["\']')


class Blocked(RuntimeError):
    pass


def get(path: str) -> bytes:
    if not path or path.startswith("/") or "\\" in path:
        raise Blocked("COB06_PACOTE_INVALIDO: caminho proibido")
    clean = posixpath.normpath(path)
    if clean != path or clean.startswith("../") or path == "..":
        raise Blocked("COB06_PACOTE_INVALIDO: path traversal")
    src = ROOT / clean
    if src.is_symlink() or not src.is_file() or not src.resolve().is_relative_to(ROOT):
        raise Blocked(f"COB06_PACOTE_INVALIDO: arquivo nao regular {path}")
    return src.read_bytes()


def gitblob(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()


def read_lock() -> list[str]:
    lock = json.loads(LOCK.read_text("utf-8"))
    if lock.get("contract") != "COB-06-billing-only" or \
       lock.get("status") != "candidate-never-auto-deploy" or \
       lock.get("hash_algorithm") != "git-blob-sha1" or \
       len(lock.get("files", [])) != len(SQL):
        raise Blocked("COB06_PACOTE_INVALIDO: lock de SQL incorreto")
    for i, expected in enumerate(SQL):
        entry = lock["files"][i]
        if set(entry) != {"path", "blob_sha1"} or entry["path"] != expected or \
           not re.fullmatch("[0-9a-f]{40}", entry["blob_sha1"]) or \
           gitblob(get(expected)) != entry["blob_sha1"]:
            raise Blocked(f"COB06_PACOTE_INVALIDO: hash/ordem SQL {i + 1}")
    return list(SQL)


def edge_dependencies() -> list[str]:
    all_paths = {EDGE, WHATSAPP_EDGE}
    pending = [EDGE, WHATSAPP_EDGE]
    while pending:
        source = pending.pop()
        text = get(source).decode("utf-8")
        for rel in SOURCE_IMPORT.findall(text):
            dep = posixpath.normpath(posixpath.join(posixpath.dirname(source), rel))
            shared_ok = dep.startswith("supabase/functions/_shared/") and \
                        dep.endswith((".ts", ".js", ".mjs"))
            whatsapp_ok = source == WHATSAPP_EDGE and dep == WHATSAPP_HELPER
            if not (shared_ok or whatsapp_ok):
                raise Blocked(f"COB06_PACOTE_INVALIDO: dependencia Edge nao autorizada {dep}")
            if dep not in all_paths:
                all_paths.add(dep)
                pending.append(dep)
        if len(all_paths) > 45:
            raise Blocked("COB06_PACOTE_INVALIDO: demasiadas dependencias")
    return sorted(all_paths)


def check_edge_security() -> None:
    text = get(EDGE).decode("utf-8")
    required = (
        'ambienteAsaasCompativelComProjeto(SUPABASE_URL,ASAAS_ENVIRONMENT_DECLARADO)',
        'const acoesPermitidasCobrancaProducao=new Set([',
        'ENVIRONMENT==="production" && !acoesPermitidasCobrancaProducao.has(acaoFinanceira)',
        'if(ENVIRONMENT==="production")enabled("billing");',
        'if(ENVIRONMENT==="production"&&event.startsWith("TRANSFER_"))',
        'if(ENVIRONMENT==="production")\n   throw new Failure("TRANSFER em fila',
        'throw new Failure("Transferência Pix de produção não está liberada.",503);',
    )
    if any(fragment not in text for fragment in required):
        raise Blocked("COB06_PACOTE_INVALIDO: roteador nao garante faturamento sem saques")
    if not re.search(
        r'if\(ENVIRONMENT!=="sandbox"\)\s*'
        r'throw new Failure\("Transferência Pix de produção não está liberada\."',
        text,
    ):
        raise Blocked("COB06_PACOTE_INVALIDO: bloqueio POST /transfers ausente")
    start = text.find("const acoesPermitidasCobrancaProducao=new Set([")
    end = text.find("]);", start)
    if start < 0 or end < 0:
        raise Blocked("COB06_PACOTE_INVALIDO: allowlist incompleta")
    actual = set(re.findall(r'"([a-z_]+)"', text[start:end]))
    allowed = {
        "consultar_termos", "aceitar_termos", "solicitar_encerramento",
        "consultar_encerramento", "listar_encerramentos_admin",
        "finalizar_encerramento_admin", "diagnosticar_webhooks_asaas_admin",
        "reprocessar_webhooks_asaas_admin", "obter_fatura",
        "criar_cobranca", "consultar_cobranca",
    }
    if actual != allowed:
        raise Blocked("COB06_PACOTE_INVALIDO: allowlist divergiu do lancamento")
    # "/saque-autorizacao" is a separate dispatcher path, currently rejected
    # by authorizeWithdrawal() when environment is production.
    if 'if(ENVIRONMENT!=="sandbox" || !WITHDRAWAL_AUTH_ON' not in text:
        raise Blocked("COB06_PACOTE_INVALIDO: webhook de saque sem trava")


def check_whatsapp_security() -> None:
    text = get(WHATSAPP_EDGE).decode("utf-8")
    required = (
        "function cob06DestinoGitHub()",
        'B!=="main"&&te!=="https://jbttwihctuibchhcyqtl.supabase.co"',
        'B==="main"&&(te!=="https://xdmbkflufsfqziixzpxc.supabase.co"',
        "catalogo_solicitar_encerramento_financeiro",
        "catalogo_finalizar_encerramento_financeiro",
        "catalogo_arquivar_sem_catalogo_admin",
        "cob06VerificarAssinaturaWhatsapp",
        'if (!I) throw new Error("Credencial GitHub nao configurada.");',
    )
    if any(fragment not in text for fragment in required):
        raise Blocked("COB06_PACOTE_INVALIDO: candidato whatsapp-bot sem guardas")
    start = text.find("async function ae(")
    end = text.find("async function _e(", start)
    if start < 0 or end <= start:
        raise Blocked("COB06_PACOTE_INVALIDO: handler de encerramento ausente")
    handler = text[start:end]
    if not (0 <= handler.find("cob06DestinoGitHub();") <
            handler.find("const busca = await Y(e);")) or \
       "if (administrador)" not in handler:
        raise Blocked("COB06_PACOTE_INVALIDO: arquivamento sem preflight GitHub")


def inventory() -> dict[str, bytes]:
    paths = read_lock()
    check_edge_security()
    check_whatsapp_security()
    paths += edge_dependencies()
    paths += list(UI) + list(DOCUMENTATION)
    if len(paths) != len(set(paths)):
        raise Blocked("COB06_PACOTE_INVALIDO: arquivo duplicado")
    result = {p: get(p) for p in paths}
    if any(p.startswith("supabase/staging-only/") or
           "/catalogo-asaas-cob06-auditoria/" in p or
           "/asaas-cob06-" in p and p.endswith(".sql") and p not in DOCUMENTATION
           for p in result):
        raise Blocked("COB06_PACOTE_INVALIDO: fixture QA adicionada")
    return result


def document(contents: dict[str, bytes]) -> dict:
    return {
        "contract": "COB-06-billing-only-review",
        "status": "CANDIDATE_NEVER_AUTO_DEPLOY",
        "sql_count": 9,
        "sql_execution_order": list(SQL),
        "financial_scope": "monthly invoice billing only; transfers, escrow and payouts HOLD",
        "warnings": [
            "EDGE SOURCE IS MIXED: payout functions exist but MUST remain unreachable in production",
            "UI FILES ARE FULL SOURCE FOR REVIEW; no automatic website overwrite",
            "NO real aggregate Pix: multi-competence billing still HOLD",
            "Do not deploy without real backup/restore, credentials, approval and environment review",
            "Includes whatsapp-bot CANDIDATE for review; live PROD v90 differs and must not be overwritten blindly",
            "Worker Cron/Vault readiness SQL is read-only; production worker is NOT installed by this archive",
            "Review verify_jwt and webhook authentication in included supabase/config.toml",
            "This archive does not contain secrets, deploy commands or environment flags",
        ],
        "files": [
            {"path": name, "bytes": len(blob),
             "sha256": hashlib.sha256(blob).hexdigest()}
            for name, blob in contents.items()
        ],
    }


def archive_bytes() -> bytes:
    contents = inventory()
    manifest = document(contents)
    serialized = json.dumps(manifest, indent=2, ensure_ascii=False).encode() + b"\n"
    contents["RELEASE-REVIEW-MANIFEST.json"] = serialized
    instructions = (
        "COB-06 BILLING-ONLY / REVIEW CANDIDATE - DO NOT DEPLOY\n"
        "Contains 9 SQL sources in order, mixed Edge source with production\n"
        "billing-only dispatcher, its imports, candidate whatsapp-bot and\n"
        "companion Storage helper, plus the catalog owner UI.\n"
        "This is NOT a ready-to-run migration or an approval to move money.\n"
        "Review the manifest, SQL schema/security, backup/restore, all runtime\n"
        "secrets and the effect on existing production pages independently.\n"
        "Inspect the included worker-readiness SELECT and config.toml; they\n"
        "are REVIEW materials only and cannot enable any Cron or billing.\n"
        "STAGING QA, experimental aggregate-Pix SQL and withdrawals excluded.\n"
    ).encode()
    contents["REVIEW-FIRST.txt"] = instructions
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
        for name in sorted(contents):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zipf.writestr(info, contents[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return buffer.getvalue()


def verify_archive(path: Path) -> None:
    expected = inventory()
    with zipfile.ZipFile(path, "r") as z:
        if z.testzip():
            raise Blocked("COB06_PACOTE_INVALIDO: ZIP corrompido")
        all_names = z.namelist()
        if len(all_names) != len(set(all_names)) or \
           set(all_names) != set(expected) | {"RELEASE-REVIEW-MANIFEST.json", "REVIEW-FIRST.txt"}:
            raise Blocked("COB06_PACOTE_INVALIDO: arquivos extras ou ausentes")
        manifest = json.loads(z.read("RELEASE-REVIEW-MANIFEST.json"))
        if manifest != document(expected):
            raise Blocked("COB06_PACOTE_INVALIDO: manifesto inconsistente")
        for name, data in expected.items():
            if z.read(name) != data:
                raise Blocked(f"COB06_PACOTE_INVALIDO: hash de {name}")
    print(f"COB06_PACOTE_REVIEW_OK: 9 SQL, {len(expected) - 9} fontes extras, nenhum deploy")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--check", action="store_true")
    choice.add_argument("--build", type=Path)
    choice.add_argument("--verify", type=Path)
    args = parser.parse_args()
    if args.check:
        result = inventory()
        print(f"COB06_PACOTE_CANDIDATO_OK: 9 SQL congelados, {len(result) - 9} fontes; SEM DEPLOY")
    elif args.build:
        blob = archive_bytes()
        args.build.parent.mkdir(parents=True, exist_ok=True)
        args.build.write_bytes(blob)
        print("COB06_PACOTE_GERADO_OFFLINE sha256=" + hashlib.sha256(blob).hexdigest())
    else:
        verify_archive(args.verify)


if __name__ == "__main__":
    try:
        main()
    except (Blocked, ValueError, OSError, KeyError, json.JSONDecodeError) as e:
        raise SystemExit(str(e))
