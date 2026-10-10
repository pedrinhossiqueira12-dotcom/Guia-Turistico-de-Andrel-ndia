#!/usr/bin/env python3
"""Teste real de duas sessoes PostgreSQL no clone de CI: sem rede/API de pagamentos.

Cenarios:
  A) evidencia excepcional (titular B) tem o ID; saque regular (titular A)
     tenta reutilizar enquanto a evidencia ainda nao fez COMMIT. Deve esperar
     no lock por ID e depois rejeitar em 23514.
  B) saque regular (titular C) registra ID primeiro; evidencia do MESMO titular
     chega depois. Deve esperar no lock do titular e ser preservada, sem baixa.

SO executar no banco local 'catalogo_asaas_guards_ci', criado e removido pelo CI.
"""
import os
import re
import select
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

EXPECTED_DB = "catalogo_asaas_guards_ci"
LOCK_TIMEOUT_SECONDS = 12
POLL_TIMEOUT_SECONDS = 9
OWNER_A = "fa411111-1111-4111-8111-111111111111"
OWNER_B = "fb422222-2222-4222-8222-222222222222"
OWNER_C = "fc433333-3333-4333-8333-333333333333"
REQUEST_B = "db422222-2222-4222-8222-222222222222"
REQUEST_C = "dc433333-3333-4333-8333-333333333333"
SAQUE_A = "ea411111-1111-4111-8111-111111111111"
SAQUE_C = "ec433333-3333-4333-8333-333333333333"
TRANSFER_A = "ci_claim_cross_owner_A"
TRANSFER_C = "ci_claim_then_late_C"


def guard_environment() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != "--database" or sys.argv[2] != EXPECTED_DB:
        raise RuntimeError("Use --database catalogo_asaas_guards_ci, nunca outra base")
    expected = {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGUSER": "postgres",
        "PGPASSWORD": "local-ci-only",
        "PGDATABASE": "catalogo_ci",
    }
    for key, required in expected.items():
        if os.environ.get(key) != required:
            raise RuntimeError(f"Ambiente de CI nao corresponde ao PostgreSQL efemero: {key}")
    for key in (
        "DATABASE_URL", "PGSERVICE", "PGHOSTADDR", "PGOPTIONS",
        "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_URL",
        "SUPABASE_PROJECT_ID", "SUPABASE_SERVICE_ROLE_KEY",
    ):
        if os.environ.get(key):
            raise RuntimeError(f"Variavel remota/produtiva proibida no teste: {key}")
    if not Path("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql").exists():
        raise RuntimeError("Execute este teste a partir da raiz do repo e apos as migracoes")


def run_sql(query: str, *, app: str = "ci_asaas_guard_check") -> str:
    env = os.environ.copy()
    env["PGAPPNAME"] = app
    cp = subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
         "-d", EXPECTED_DB, "-c", query],
        env=env, capture_output=True, text=True, timeout=8, check=False,
    )
    if cp.returncode:
        raise AssertionError(f"Consulta local falhou: {cp.stderr[-700:]}")
    return cp.stdout.strip()


@dataclass
class Session:
    name: str
    proc: subprocess.Popen
    unread: bytes = b""

    @classmethod
    def start(cls, name: str) -> "Session":
        env = os.environ.copy()
        env["PGAPPNAME"] = name
        proc = subprocess.Popen(
            ["psql", "-X", "-q", "-A", "-t",
             "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
             "-d", EXPECTED_DB],
            env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, bufsize=0,
        )
        return cls(name, proc)

    def send(self, sql: str) -> None:
        if self.proc.poll() is not None:
            raise AssertionError(f"{self.name}: sessao encerrada antes de receber SQL")
        assert self.proc.stdin is not None
        self.proc.stdin.write(sql.encode("utf-8") + b"\n")
        self.proc.stdin.flush()

    def until(self, marker: str, timeout: float = POLL_TIMEOUT_SECONDS) -> None:
        assert self.proc.stdout is not None
        needle = marker.encode("ascii")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle in self.unread:
                self.unread = self.unread.split(needle, 1)[1]
                return
            if self.proc.poll() is not None:
                err = self.proc.stderr.read().decode("utf-8", errors="replace")
                raise AssertionError(f"{self.name} encerrou antes de {marker}: {err[-700:]}")
            remaining = deadline - time.monotonic()
            readable, _, _ = select.select([self.proc.stdout], [], [], max(0, min(0.3, remaining)))
            if readable:
                chunk = os.read(self.proc.stdout.fileno(), 4096)
                if chunk:
                    self.unread += chunk
                    continue
                break
        raise AssertionError(f"{self.name} nao sinalizou {marker} no prazo")

    def finish(self, expected_error: str | None = None) -> None:
        try:
            if self.proc.poll() is None:
                self.send("\\q")
            stdout, stderr = self.proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            stdout, stderr = self.proc.communicate(timeout=3)
            raise AssertionError(f"{self.name}: possivel deadlock ou sessao travada")
        err = stderr.decode("utf-8", errors="replace")
        if expected_error:
            if self.proc.returncode == 0 or expected_error not in err:
                raise AssertionError(
                    f"{self.name}: deveria rejeitar {expected_error}, retorno={self.proc.returncode}: {err[-800:]}"
                )
        elif self.proc.returncode != 0:
            raise AssertionError(f"{self.name}: falha inesperada: {err[-800:]}")

    def abort(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
        try:
            self.proc.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.communicate(timeout=2)


def assert_waiting_advisory(app: str) -> None:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        state = run_sql(
            "SELECT COALESCE(wait_event_type,'none') || ':' || COALESCE(wait_event,'none') "
            "FROM pg_stat_activity WHERE application_name='" + app + "' "
            "AND datname=current_database() ORDER BY backend_start DESC LIMIT 1"
        )
        if state == "Lock:advisory":
            return
        time.sleep(0.10)
    raise AssertionError(f"{app}: nao houve espera real no advisory lock (ultimo estado {state!r})")


def prepare() -> None:
    db_and_addr = run_sql(
        "SELECT current_database() || '|' || (inet_server_addr() IS NOT NULL)::text"
    )
    if db_and_addr != EXPECTED_DB + "|true":
        raise RuntimeError("O banco nao e o clone local esperado: " + db_and_addr)
    if run_sql(
        "SELECT count(*) FROM pg_available_extensions "
        "WHERE name IN ('pg_cron','pg_net')"
    ) != "0":
        raise RuntimeError("Extensoes remotas nao permitidas neste clone")
    if run_sql(
        "SELECT count(*) FROM pg_trigger WHERE tgname IN "
        "('yy_catalogo_asaas_nao_reusar_transferencia_regular', "
        " 'zy_catalogo_asaas_serializar_id_evidencia_tardia') AND tgenabled='O'"
    ) != "2":
        raise RuntimeError("Travas de concorrencia nao instaladas")
    # Somente tres usuarios totalmente ficticios e duas solicitacoes recusadas.
    # A reserva regular e criada DEPOIS do encerramento do pedido excepcional.
    seed = f"""
    BEGIN;
    INSERT INTO auth.users(id) VALUES ('{OWNER_A}'),('{OWNER_B}'),('{OWNER_C}');
    INSERT INTO public.catalogo_asaas_saldos_residuais
      (id,motoboy_id,saldo_snapshot_centavos,motivo)
    VALUES ('{REQUEST_B}','{OWNER_B}',12000,'inatividade'),
           ('{REQUEST_C}','{OWNER_C}',12000,'inatividade');
    UPDATE public.catalogo_asaas_saldos_residuais
      SET status='recusada',analisado_por=motoboy_id,
          finalizado_em=now(),detalhe_revisao='CI: simulacao sem pagamento'
      WHERE id IN ('{REQUEST_B}','{REQUEST_C}');
    INSERT INTO public.catalogo_asaas_saques(id,motoboy_id,valor_centavos)
      VALUES ('{SAQUE_A}','{OWNER_A}',12000),
             ('{SAQUE_C}','{OWNER_C}',12000);
    UPDATE public.catalogo_asaas_saques
      SET pix_destino_sha256=repeat('b',64)
      WHERE id IN ('{SAQUE_A}','{SAQUE_C}');
    COMMIT;
    """
    run_sql(seed)


def scenario_evidence_first_cross_owner() -> None:
    # Sessao A registra evidencia para titular B e segura transacao aberta.
    # Sessao B tenta anexar o MESMO ID ao saque de titular A.
    a = Session.start("ci_asaas_cross_evidence")
    b = None
    try:
        a.send(f"""BEGIN;
        INSERT INTO public.catalogo_asaas_transferencias_excepcionais_auditoria
          (tipo,solicitacao_id,motoboy_id,valor_centavos,transferencia_id,referencia_externa)
        VALUES ('residual','{REQUEST_B}','{OWNER_B}',12000,
          '{TRANSFER_A}','guia-exc:residual:{REQUEST_B}');
        \\echo EVIDENCE_READY""")
        a.until("EVIDENCE_READY")
        b = Session.start("ci_asaas_cross_claim")
        b.send(f"""SET lock_timeout='10s';
        UPDATE public.catalogo_asaas_saques
        SET transferencia_id='{TRANSFER_A}' WHERE id='{SAQUE_A}';""")
        assert_waiting_advisory(b.name)
        a.send("COMMIT;\n\\echo EVIDENCE_COMMITTED")
        a.until("EVIDENCE_COMMITTED")
        b.finish(expected_error="23514")
        b = None
        a.finish()
    finally:
        if b is not None:
            b.abort()
        a.abort()
    actual = run_sql(
        f"SELECT (transferencia_id IS NULL)::text FROM public.catalogo_asaas_saques "
        f"WHERE id='{SAQUE_A}'"
    )
    if actual != "true":
        raise AssertionError("Novo saque regular persistiu ID ja reivindicado por evidencia")
    actual = run_sql(
        f"SELECT count(*) FROM public.catalogo_asaas_transferencias_excepcionais_auditoria "
        f"WHERE transferencia_id='{TRANSFER_A}'"
    )
    if actual != "1":
        raise AssertionError("Evidencia cross-owner nao foi preservada")
    print("PASS: duas sessoes, evidencia cross-owner primeiro: espera no lock do ID e rejeicao 23514", flush=True)


def scenario_claim_first_late_evidence() -> None:
    # Sessao A associa ID de transferencia e mantem lock do titular C.
    # Sessao B recebe evidencia excepcional DEPOIS, deve ser inserida para
    # preservar o conflito; a regra nao pode esconder essa prova.
    a = Session.start("ci_asaas_regular_claim")
    b = None
    try:
        a.send(f"""BEGIN;
        UPDATE public.catalogo_asaas_saques
          SET transferencia_id='{TRANSFER_C}' WHERE id='{SAQUE_C}';
        \\echo CLAIM_READY""")
        a.until("CLAIM_READY")
        b = Session.start("ci_asaas_late_evidence")
        b.send(f"""SET lock_timeout='10s';
        INSERT INTO public.catalogo_asaas_transferencias_excepcionais_auditoria
          (tipo,solicitacao_id,motoboy_id,valor_centavos,transferencia_id,referencia_externa)
        VALUES ('residual','{REQUEST_C}','{OWNER_C}',12000,
          '{TRANSFER_C}','guia-exc:residual:{REQUEST_C}');
        \\echo LATE_EVIDENCE_RECORDED""")
        assert_waiting_advisory(b.name)
        a.send("COMMIT;\n\\echo CLAIM_COMMITTED")
        a.until("CLAIM_COMMITTED")
        b.until("LATE_EVIDENCE_RECORDED")
        b.finish()
        b = None
        a.finish()
    finally:
        if b is not None:
            b.abort()
        a.abort()
    # A colisao posterior e explicita; nunca transforma o status em pago.
    shared = run_sql(f"""
      SELECT count(*) FROM public.catalogo_asaas_saques s
      JOIN public.catalogo_asaas_transferencias_excepcionais_auditoria e
        ON e.transferencia_id=s.transferencia_id
      WHERE e.transferencia_id='{TRANSFER_C}' AND s.id='{SAQUE_C}'
    """)
    status = run_sql(
        f"SELECT status FROM public.catalogo_asaas_saques WHERE id='{SAQUE_C}'"
    )
    if shared != "1" or status != "reservado":
        raise AssertionError(f"Conflito tardio nao foi preservado em HOLD: shared={shared} status={status}")
    print("PASS: duas sessoes, saque primeiro: evidencia tardia registrada sem baixa", flush=True)


def main() -> None:
    guard_environment()
    prepare()
    scenario_evidence_first_cross_owner()
    scenario_claim_first_late_evidence()
    print("PASS: concorrencia real com 2 sessoes, IDs e usuarios sinteticos, zero Pix", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL: " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
