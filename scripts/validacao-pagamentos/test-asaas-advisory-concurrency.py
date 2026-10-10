#!/usr/bin/env python3
"""Teste real de duas sessoes PostgreSQL no clone de CI: sem rede/API de pagamentos.

Cenarios:
  A) evidencia excepcional (titular B) tem o ID; saque regular (titular A)
     tenta reutilizar enquanto a evidencia ainda nao fez COMMIT. Deve esperar
     no lock por ID e depois rejeitar em 23514.
  B) saque regular (titular C) registra ID primeiro; evidencia do MESMO titular
     chega depois. Deve esperar no lock do titular e ser preservada, sem baixa.
  C) duas sessoes diferentes usam o mesmo nonce documental: uma confirma,
     a outra espera LOCK no header e recebe rejeicao de replay. Zero Pix.
  D) primeira observacao de outro nonce sofre ROLLBACK: a segunda,
     que estava aguardando o lock, conclui sem perder nem duplicar o uso.
  E) tentativas step-up falsificadas: dois processos COMMIT/ROLLBACK com
     LOCK advisory por revisor, quota 3/h, uma por challenge, zero Pix.

SO executar no banco local 'catalogo_asaas_race_ci', criado e removido pelo CI.
"""
import os
import re
import select
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

EXPECTED_DB = "catalogo_asaas_race_ci"
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
        raise RuntimeError("Use --database catalogo_asaas_race_ci, nunca outra base")
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

    def until(self, marker: str, timeout: float = POLL_TIMEOUT_SECONDS) -> str:
        assert self.proc.stdout is not None
        needle = marker.encode("ascii")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if needle in self.unread:
                received, self.unread = self.unread.split(needle, 1)
                return received.decode("utf-8", errors="replace")
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
    VALUES ('{REQUEST_B}','{OWNER_B}',2500,'inatividade'),
           ('{REQUEST_C}','{OWNER_C}',2500,'inatividade');
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
        VALUES ('residual','{REQUEST_B}','{OWNER_B}',2500,
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
        VALUES ('residual','{REQUEST_C}','{OWNER_C}',2500,
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



# Teste da etapa #42: os identificadores sao FICTICIOS, criados apenas no clone.
NONCE_OWNER = "fd511111-1111-4111-8111-111111111111"
NONCE_REVIEWER = "fd522222-2222-4222-8222-222222222222"
NONCE_INDICATOR = "fd533333-3333-4333-8333-333333333333"
NONCE_SESSION = "fd544444-4444-4444-8444-444444444444"
NONCE_FACTOR = "fd555555-5555-4555-8555-555555555555"
NONCE_STORE = "ci-nonce-race-commerce"


def seed_document_nonce() -> str:
    """Cria dois creditos reais do fixture, escrow congelado e nonce AAL2 de ensaio.

    Sem provedores externos. Apenas no banco efemero que sera destruido pela CI.
    """
    query = f"""
    BEGIN;
    DO $nonce_seed$
    DECLARE
      v_owner uuid := '{NONCE_OWNER}'::uuid;
      v_reviewer uuid := '{NONCE_REVIEWER}'::uuid;
      v_indicator uuid := '{NONCE_INDICATOR}'::uuid;
      v_store text := '{NONCE_STORE}';
      v_competencia date;
      v_pedido uuid;
      v_fechamento uuid;
      v_saida uuid;
      v_reserva jsonb;
      v_evento jsonb;
      v_intencao jsonb;
      v_escrow uuid;
      v_i int;
      v_epoch bigint;
    BEGIN
      INSERT INTO auth.users(id) VALUES(v_owner),(v_reviewer),(v_indicator);
      INSERT INTO public.comercios_publicados(local_id,status)
        VALUES(v_store,'ativo');
      INSERT INTO public.catalogos(comercio_id,proprietario_id)
        VALUES(v_store,v_owner);
      INSERT INTO public.catalogo_motoboys(
        comercio_id,usuario_id,nome,email,ativo,autorizado_por
      ) VALUES(v_store,v_owner,'Entregador CI nonce','nonce@example.invalid',true,v_owner);
      FOR v_i IN 1..2 LOOP
        v_competencia:=make_date(2097,v_i,1);
        INSERT INTO public.catalogo_pedidos(
          comercio_id,referencia_externa,provedor,idempotency_key,status,
          status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
          entrega_centavos,total_centavos,taxa_plataforma_centavos,
          repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
          versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
          entrega_status,metadata
        ) VALUES(v_store,'ci-nonce-race-'||v_i,'offline',gen_random_uuid(),
          'entregue','aprovado','entrega','dinheiro',300000,0,300000,15000,279000,
          'Cliente sintético','00000000000',2,6000,21000,'entregue',
          jsonb_build_object('ensaio','nonce_concorrente','mes',v_i))
        RETURNING id INTO v_pedido;
        INSERT INTO public.catalogo_fechamentos_offline(
          comercio_id,competencia,total_pedidos,total_comissao_centavos,status,pago_em
        ) VALUES(v_store,v_competencia,1,21000,'pago',now())
        RETURNING id INTO v_fechamento;
        INSERT INTO public.catalogo_fatura_componentes_v2(
          fechamento_id,pedido_id,tipo,valor_centavos
        ) VALUES(v_fechamento,v_pedido,'plataforma',15000),
          (v_fechamento,v_pedido,'logistica',6000);
        INSERT INTO public.catalogo_comissoes_offline(
          pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
          taxa_percentual,valor_comissao_centavos,status,pago_em,
          taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
          versao_financeira,motoboy_id,financiamento_logistica_comprovado
        ) VALUES(v_pedido,v_store,v_competencia,300000,5,21000,'paga',now(),
          15000,6000,21000,2,v_owner,true);
        INSERT INTO public.catalogo_fatura_cobrancas(
          fechamento_id,comercio_id,competencia,gateway,
          payment_id,status,valor_centavos,pago_em
        ) VALUES(v_fechamento,v_store,v_competencia,'asaas',
          'ci-nonce-fatura-'||v_i,'pago',21000,now());
        IF NOT catalogo_private.catalogo_v2_financiado(v_pedido) THEN
          RAISE EXCEPTION 'CI: credito nonce sem financiamento';
        END IF;
        INSERT INTO public.catalogo_remuneracoes_v2(
          pedido_id,comercio_id,motoboy_id,valor_centavos,
          status,financiamento_comprovado
        ) VALUES(v_pedido,v_store,v_owner,6000,'disponivel',true);
      END LOOP;
      DELETE FROM public.catalogo_motoboys WHERE usuario_id=v_owner;
      INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
        motoboy_id,saldo_snapshot_centavos,motivo
      ) VALUES(v_owner,12000,'inatividade') RETURNING id INTO v_saida;
      v_reserva:=public.catalogo_asaas_separar_creditos_excepcionais('saida',v_saida);
      IF v_reserva->>'ok' IS DISTINCT FROM 'true'
        OR v_reserva->>'creditos_separados' IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'CI: escrow sintetico nao criado: %',v_reserva;
      END IF;
      v_escrow:=(v_reserva->>'separacao_id')::uuid;
      v_evento:=public.catalogo_asaas_registrar_evento_dossie_escrow(
        v_escrow,v_owner,'fd566666-6666-4666-8666-666666666666'::uuid,
        'verificacao_banco',
        'Evento ficticio de verificacao para concorrencia de nonce documental.'
      );
      IF v_evento->>'ok' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'CI: dossier inexistente: %',v_evento;
      END IF;
      INSERT INTO public.catalogo_asaas_revisores_escrow_ensaio(
        revisor_id,indicado_por,justificativa,instrumento_sha256,
        cadastrado_em,valido_ate
      ) VALUES(v_reviewer,v_indicator,
        'Revisor sintético e temporário para concorrencia real de nonce de CI.',
        repeat('a',64),now(),now()+interval '1 hour');
      INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after)
        VALUES('{NONCE_SESSION}'::uuid,v_reviewer,'aal2',
          '{NONCE_FACTOR}'::uuid,now()+interval '1 hour');
      v_epoch:=(extract(epoch FROM now()))::bigint;
      PERFORM set_config('request.jwt.claim.sub',v_reviewer::text,true);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object(
        'sub',v_reviewer::text,'role','authenticated','aal','aal2',
        'session_id','{NONCE_SESSION}','iat',v_epoch,
        'exp',v_epoch+1800,'is_anonymous',false)::text,true);
      v_intencao:=catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(v_escrow);
      IF v_intencao->>'ok' IS DISTINCT FROM 'true'
        OR v_intencao->>'pagamento_autorizado' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'CI: nonce documental inerte nao emitido: %',v_intencao;
      END IF;
    END $nonce_seed$;
    COMMIT;
    """
    run_sql(query, app="ci_nonce_seed")
    nonce = run_sql(
        f"SELECT nonce FROM public.catalogo_asaas_intencoes_mfa_documentais_ensaio "
        f"WHERE revisor_id='{NONCE_REVIEWER}'"
    )
    if not re.fullmatch(r"[0-9a-f-]{36}", nonce):
        raise AssertionError("Nonce sintético nao localizado no clone")
    return nonce


def context_for_nonce() -> str:
    # SET sao executados so na conexao mock PostgreSQL sem JWT real.
    return f"""
        SELECT pg_catalog.set_config('request.jwt.claim.role','authenticated',false);
        SELECT pg_catalog.set_config('request.jwt.claim.sub','{NONCE_REVIEWER}',false);
        SELECT pg_catalog.set_config('request.jwt.claims',
          pg_catalog.jsonb_build_object(
           'sub','{NONCE_REVIEWER}','role','authenticated','aal','aal2',
           'session_id','{NONCE_SESSION}',
           'iat',(extract(epoch FROM now()))::bigint,
           'exp',(extract(epoch FROM now()))::bigint+1800,
           'is_anonymous',false
          )::text,false);
    """


def assert_waiting_nonce_lock(app: str) -> None:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    last = "not-started"
    while time.monotonic() < deadline:
        last = run_sql(
          "SELECT COALESCE(wait_event_type,'none')||':'||COALESCE(wait_event,'none') "
          f"FROM pg_stat_activity WHERE application_name='{app}' "
          "AND datname=current_database() ORDER BY backend_start DESC LIMIT 1"
        )
        if last in ("Lock:transactionid", "Lock:tuple"):
            return
        time.sleep(0.10)
    raise AssertionError(f"{app}: nao aguardou o lock de um nonce unico ({last})")


def scenario_same_nonce_concurrent() -> None:
    """Prova concorrencia entre 2 backends reais (nao duas calls em 1 transacao)."""
    nonce = seed_document_nonce()
    first = Session.start("ci_nonce_first_writer")
    second = None
    try:
        first.send(context_for_nonce() + f"""
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio('{nonce}'::uuid);
          \\echo NONCE_FIRST_OBSERVED""")
        observed1 = first.until("NONCE_FIRST_OBSERVED")
        if '"ok": true' not in observed1 or '"nonce_observado_uma_vez": true' not in observed1:
            raise AssertionError(f"Primeira observacao nao aconteceu: {observed1[-700:]}")

        second = Session.start("ci_nonce_second_writer")
        second.send(context_for_nonce() + f"""
          SET lock_timeout='10s';
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio('{nonce}'::uuid);
          \\echo NONCE_SECOND_REJECTED""")
        assert_waiting_nonce_lock(second.name)

        first.send("COMMIT;\n\\echo NONCE_FIRST_COMMITTED")
        first.until("NONCE_FIRST_COMMITTED")
        observed2 = second.until("NONCE_SECOND_REJECTED")
        if '"nonce_ja_observado"' not in observed2 or '"ok": false' not in observed2:
            raise AssertionError(f"Segundo observador nao recebeu replay: {observed2[-700:]}")
        second.send("COMMIT;\n\\echo NONCE_SECOND_COMMITTED")
        second.until("NONCE_SECOND_COMMITTED")
        second.finish()
        second = None
        first.finish()
    finally:
        if second is not None:
            second.abort()
        first.abort()

    count = run_sql(
        f"SELECT count(*)||'|'||max(resultado) "
        "FROM public.catalogo_asaas_usos_nonce_documentais_ensaio "
        f"WHERE nonce='{nonce}'"
    )
    if count != "1|vinculo_documental_observado":
        raise AssertionError(f"Concorrencia inseriu usos de nonce duplicados: {count}")
    status = run_sql(
        "SELECT count(*)||'|'||coalesce(sum(valor_centavos),0) "
        "FROM public.catalogo_remuneracoes_v2 "
        f"WHERE motoboy_id='{NONCE_OWNER}' AND status='disponivel' "
        "AND repasse_id IS NULL"
    )
    if status != "2|12000":
        raise AssertionError(f"Concorrencia alterou ou baixou creditos retidos: {status}")
    if run_sql(
        f"SELECT count(*) FROM public.catalogo_asaas_saques WHERE motoboy_id='{NONCE_OWNER}'"
    ) != "0":
        raise AssertionError("Observacao de nonce gerou saque bancario")
    print(
        "PASS: duas sessoes concorrentes aguardaram Lock:transactionid/tuple; "
        "uma unica observacao documental, replay recusado, 12000 centavos HOLD e zero Pix",
        flush=True,
    )



def scenario_nonce_rollback_then_second_succeeds() -> None:
    """Se a primeira transacao rollbackar, o segundo observador pode gravar."""
    output = run_sql(
        context_for_nonce() + """
        SELECT catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(
          (SELECT id FROM public.catalogo_asaas_separacoes_excepcionais
           WHERE motoboy_id='fd511111-1111-4111-8111-111111111111')
        );
        """,
        app="ci_nonce_rollback_seed",
    )
    match = re.search(r'"nonce": "([0-9a-f-]{36})"', output)
    if not match:
        raise AssertionError(f"Segundo nonce nao emitido para testar rollback: {output[-500:]}")
    nonce = match.group(1)
    first = Session.start("ci_nonce_rollback_first")
    second = None
    try:
        first.send(context_for_nonce() + f"""
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio('{nonce}'::uuid);
          \\echo NONCE_ROLLBACK_FIRST_OBSERVED""")
        result1 = first.until("NONCE_ROLLBACK_FIRST_OBSERVED")
        if '"nonce_observado_uma_vez": true' not in result1:
            raise AssertionError(f"Primeiro intento de rollback nao observou nonce: {result1[-500:]}")

        second = Session.start("ci_nonce_rollback_second")
        second.send(context_for_nonce() + f"""
          SET lock_timeout='10s';
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio('{nonce}'::uuid);
          \\echo NONCE_ROLLBACK_SECOND_OBSERVED""")
        assert_waiting_nonce_lock(second.name)

        first.send("ROLLBACK;\n\\echo NONCE_FIRST_ROLLED_BACK")
        first.until("NONCE_FIRST_ROLLED_BACK")
        result2 = second.until("NONCE_ROLLBACK_SECOND_OBSERVED")
        if '"nonce_observado_uma_vez": true' not in result2 or '"ok": true' not in result2:
            raise AssertionError(f"Segundo observador ficou sem nonce apos rollback: {result2[-700:]}")
        second.send("COMMIT;\n\\echo NONCE_ROLLBACK_SECOND_COMMITTED")
        second.until("NONCE_ROLLBACK_SECOND_COMMITTED")
        second.finish()
        second = None
        first.finish()
    finally:
        if second is not None:
            second.abort()
        first.abort()
    result = run_sql(
        "SELECT count(*)||'|'||max(resultado) "
        "FROM public.catalogo_asaas_usos_nonce_documentais_ensaio "
        f"WHERE nonce='{nonce}'"
    )
    if result != "1|vinculo_documental_observado":
        raise AssertionError(f"Rollback deixou nonce duplicado/sem uso: {result}")
    print(
        "PASS: duas sessoes, ROLLBACK da primeira permite segundo uso atomico; "
        "uma unica observacao persistida, sem Pix",
        flush=True,
    )



def issue_stepup_challenge_for_race() -> str:
    """Challenge falso ligado a novo nonce; autenticacao mock somente no clone."""
    output = run_sql(
        context_for_nonce() + f"""
        SELECT catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(
          (SELECT id FROM public.catalogo_asaas_separacoes_excepcionais
           WHERE motoboy_id='{NONCE_OWNER}')
        );
        """,
        app="ci_stepup_nonce_issuer",
    )
    match = re.search(r'"nonce": "([0-9a-f-]{36})"', output)
    if not match:
        raise AssertionError("CI nao emitiu nonce para o challenge sintético: " + output[-350:])
    nonce = match.group(1)
    created = run_sql(
        context_for_nonce() + f"""
        INSERT INTO public.catalogo_asaas_stepup_desafios_documentais_ensaio(
          nonce,challenge_id)
        VALUES('{nonce}'::uuid,gen_random_uuid()) RETURNING challenge_id;
        """,
        app="ci_stepup_challenge_issuer",
    )
    # Output do psql contem 3 SELECT set_config antes do INSERT.
    # Tomar somente a ULTIMA linha, que e o RETURNING challenge_id.
    candidate = created.strip().splitlines()[-1].strip()
    if not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        candidate,
    ):
        raise AssertionError("Challenge de laboratorio nao persistido corretamente: " + created[-500:])
    return candidate


def assert_waiting_stepup_advisory(app: str) -> None:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    last = "none"
    while time.monotonic() < deadline:
        last = run_sql(
          "SELECT COALESCE(wait_event_type,'none')||':'||COALESCE(wait_event,'none') "
          f"FROM pg_stat_activity WHERE application_name='{app}' "
          "AND datname=current_database() ORDER BY backend_start DESC LIMIT 1"
        )
        if last == "Lock:advisory":
            return
        time.sleep(0.10)
    raise AssertionError(f"Challenge stepup nao aguardou advisory por revisor ({last})")


def scenario_stepup_attempts_concurrent_and_quota() -> None:
    """Duas transacoes COMMIT/ROLLBACK + taxa real 3/h, sem OTP ou dinheiro."""
    run_sql(
        f"INSERT INTO auth.mfa_factors(id,user_id,factor_type,status) "
        f"VALUES('{NONCE_FACTOR}'::uuid,'{NONCE_REVIEWER}'::uuid,'totp','verified')",
        app="ci_stepup_factor_fake",
    )
    challenge = issue_stepup_challenge_for_race()
    first = Session.start("ci_stepup_first_commit")
    second = None
    try:
        first.send(context_for_nonce() + f"""
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{challenge}'::uuid);
          \\echo STEPUP_FIRST_RESERVED""")
        a = first.until("STEPUP_FIRST_RESERVED")
        if '"ok": true' not in a or '"verificacao_otp_realizada": false' not in a:
            raise AssertionError("Primeiro claim stepup nao inerte: " + a[-550:])
        second = Session.start("ci_stepup_second_replay")
        second.send(context_for_nonce() + f"""
          SET lock_timeout='10s';
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{challenge}'::uuid);
          \\echo STEPUP_SECOND_REJECTED""")
        assert_waiting_stepup_advisory(second.name)
        first.send("COMMIT;\n\\echo STEPUP_FIRST_COMMITTED")
        first.until("STEPUP_FIRST_COMMITTED")
        b = second.until("STEPUP_SECOND_REJECTED")
        if '"ok": false' not in b or '"tentativa_ja_registrada"' not in b:
            raise AssertionError("Outro processo reutilizou o challenge: " + b[-550:])
        second.send("COMMIT;\n\\echo STEPUP_SECOND_COMMITTED")
        second.until("STEPUP_SECOND_COMMITTED")
        second.finish()
        second = None
        first.finish()
    finally:
        if second:
            second.abort()
        first.abort()
    if run_sql(
        "SELECT count(*) FROM public.catalogo_asaas_stepup_tentativas_inertes "
        f"WHERE challenge_id='{challenge}'"
    ) != "1":
        raise AssertionError("Replay concorrente de MFA duplicou livro de tentativas")

    # Primeiro observador faz rollback antes que o segundo leia a linha.
    challenge2 = issue_stepup_challenge_for_race()
    first = Session.start("ci_stepup_rollback_first")
    second = None
    try:
        first.send(context_for_nonce() + f"""
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{challenge2}'::uuid);
          \\echo STEPUP_ROLLBACK_FIRST""")
        a = first.until("STEPUP_ROLLBACK_FIRST")
        if '"ok": true' not in a:
            raise AssertionError("Primeiro claim stepup para rollback falhou: "+a[-500:])
        second = Session.start("ci_stepup_rollback_second")
        second.send(context_for_nonce() + f"""
          SET lock_timeout='10s';
          BEGIN;
          SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{challenge2}'::uuid);
          \\echo STEPUP_ROLLBACK_SECOND""")
        assert_waiting_stepup_advisory(second.name)
        first.send("ROLLBACK;\n\\echo STEPUP_FIRST_ROLLBACK_DONE")
        first.until("STEPUP_FIRST_ROLLBACK_DONE")
        b = second.until("STEPUP_ROLLBACK_SECOND")
        if '"ok": true' not in b or '"verificacao_otp_realizada": false' not in b:
            raise AssertionError("Segundo claim nao prosseguiu apos rollback: "+b[-550:])
        second.send("COMMIT;\n\\echo STEPUP_SECOND_COMMIT_DONE")
        second.until("STEPUP_SECOND_COMMIT_DONE")
        second.finish()
        second = None
        first.finish()
    finally:
        if second:
            second.abort()
        first.abort()
    if run_sql(
        "SELECT count(*) FROM public.catalogo_asaas_stepup_tentativas_inertes "
        f"WHERE challenge_id='{challenge2}'"
    ) != "1":
        raise AssertionError("Rollback de desafio deixou registro duplo/ausente")

    third = issue_stepup_challenge_for_race()
    response = run_sql(
        context_for_nonce() +
        f"SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{third}'::uuid);",
        app="ci_stepup_third",
    )
    if '"ok": true' not in response or '"pagamento_autorizado": false' not in response:
        raise AssertionError("Terceiro claim nao respeitou HOLD: "+response[-450:])

    fourth = issue_stepup_challenge_for_race()
    response = run_sql(
        context_for_nonce() +
        f"SELECT catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte('{fourth}'::uuid);",
        app="ci_stepup_fourth",
    )
    if '"limite_tres_por_hora"' not in response or '"ok": false' not in response:
        raise AssertionError("Rate limit persistente nao recusou a quarta tentativa: "+response[-450:])
    count = run_sql(
        "SELECT count(*)||'|'||count(DISTINCT nonce) "
        "FROM public.catalogo_asaas_stepup_tentativas_inertes "
        f"WHERE revisor_id='{NONCE_REVIEWER}'"
    )
    if count != "3|3":
        raise AssertionError("Rate limit persistente deveria manter tres usos distintos: "+count)
    if run_sql(
        f"SELECT count(*) FROM public.catalogo_asaas_saques WHERE motoboy_id='{NONCE_OWNER}'"
    ) != "0":
        raise AssertionError("Livro de tentativas gerou saque")
    print("PASS: concorrencia stepup Lock:advisory COMMIT/ROLLBACK, unica tentativa "
          "por challenge, rate 3/h e zero Pix",flush=True)


def main() -> None:
    guard_environment()
    prepare()
    scenario_evidence_first_cross_owner()
    scenario_claim_first_late_evidence()
    scenario_same_nonce_concurrent()
    scenario_nonce_rollback_then_second_succeeds()
    scenario_stepup_attempts_concurrent_and_quota()
    print("PASS: concorrencia real com 2 sessoes, IDs e usuarios sinteticos, zero Pix", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL: " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
