#!/usr/bin/env python3
"""Prova de concorrência multissessão para entregas v2 no staging autorizado.

O módulo não executa nada ao ser importado. A execução exige --allow-staging e
usa exclusivamente o Native CLI do Supabase execute_sql. Os dois participantes
de cada race são Popen independentes; uma terceira sessão lê pg_stat_activity.
Todos os pagamentos e comprovantes deste arquivo são QA fictícios: nenhuma
integração Mercado Pago, Pix, banco ou transferência é chamada.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import re
import secrets
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

STAGING_PROJECT = "jbttwihctuibchhcyqtl"
ROOT_ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b"
CASE_TIMEOUT_SECONDS = 180
DB_SLEEP_SECONDS = 6
REPORT_PATH = Path("/home/ubuntu/antifraude-runtime/concorrencia-staging-resultado.md")
SCRIPT_PATH = Path("/home/ubuntu/marketplace-antifraude/scripts/entregas-v2/testar_concorrencia_staging.py")
CLI = "manus-mcp-cli"


class TestFailure(RuntimeError):
    """Falha controlada do experimento; o texto é registrado no relatório."""


class PermissionFailure(TestFailure):
    """Falha de permissão que nunca deve ser contornada pelo teste."""


class SafetyFailure(TestFailure):
    """Pré-condição de segurança do staging não atendida."""


@dataclass
class CliResult:
    label: str
    query: str
    rows: list[Any]
    result_file: str | None
    stdout_tail: str
    stderr_tail: str
    returncode: int
    elapsed_seconds: float


@dataclass
class Namespace:
    nonce: str
    commerce: str
    owner: str
    rider_a: str
    rider_b: str
    root: str
    owner_email: str
    rider_a_email: str
    rider_b_email: str
    root_email: str
    root_created: bool = False
    orders: dict[str, str] = field(default_factory=dict)
    payment_refs: dict[str, str] = field(default_factory=dict)
    status_hashes: dict[str, str] = field(default_factory=dict)
    race_refs: dict[str, str] = field(default_factory=dict)


@dataclass
class ChildHandle:
    label: str
    query: str
    input_path: Path
    requested_result_path: Path
    process: asyncio.subprocess.Process
    started_at: float


@dataclass
class RaceResult:
    case: str
    tag: str
    children: list[CliResult]
    observer: CliResult | None
    overlap: dict[str, Any]
    state: dict[str, Any]
    classification: str
    error: str | None = None


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def sql_literal(value: str) -> str:
    """Literal SQL para valores gerados pelo próprio script, nunca por retorno DB."""
    return "'" + value.replace("'", "''") + "'"


def uuid_text() -> str:
    return str(uuid.uuid4())


def sha256_hex(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def qrpc(name: str, args: Iterable[str]) -> str:
    return f"SELECT public.{name}({','.join(args)}) AS result LIMIT 1;"


def tx_body(statements: Iterable[str], marker: str = "done") -> str:
    # O adaptador devolve só o último SELECT. DO valida cada RPC antes do commit.
    sql=[]
    for statement in statements:
        match=re.fullmatch(r"SELECT (public\..*) AS result LIMIT 1;",statement,flags=re.DOTALL)
        if match:
            sql.append("DO $qa$ DECLARE r jsonb; BEGIN r := " + match.group(1) + "; IF coalesce((r->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'QA RPC: %',r; END IF; END $qa$;")
        else: sql.append(statement)
    return "BEGIN;\n"+"\n".join(sql)+"\nCOMMIT;\nSELECT jsonb_build_object('marker',"+sql_literal(marker)+") AS marker,jsonb_build_object('ok',true) AS result LIMIT 1;"


def snapshot_query() -> str:
    tables = [
        ("comercios_publicados", "public.comercios_publicados"),
        ("catalogos", "public.catalogos"),
        ("motoboys", "public.catalogo_motoboys"),
        ("perfis", "public.catalogo_motoboy_perfis"),
        ("pedidos", "public.catalogo_pedidos"),
        ("itens", "public.catalogo_pedido_itens"),
        ("atribuicoes", "public.catalogo_entregas_atribuidas"),
        ("gestao_eventos", "public.catalogo_entregas_gestao_eventos"),
        ("pagamentos", "public.catalogo_pagamentos_v2"),
        ("pagamento_eventos", "public.catalogo_pagamento_eventos_v2"),
        ("remuneracoes", "public.catalogo_remuneracoes_v2"),
        ("lancamentos", "public.catalogo_lancamentos_financeiros_v2"),
        ("repasses", "public.catalogo_repasses_v2"),
        ("ocorrencias", "public.catalogo_ocorrencias_v2"),
        ("comissoes_offline", "public.catalogo_comissoes_offline"),
        ("logistica_offline", "public.catalogo_logistica_offline_v2"),
        ("fatura_componentes", "public.catalogo_fatura_componentes_v2"),
        ("auth_users", "auth.users"),
    ]
    pieces: list[str] = []
    for key, table in tables:
        pieces.append(f"{sql_literal(key)},(SELECT count(*)::int FROM {table} LIMIT 1)")
    pieces.append(
        "'config',(SELECT jsonb_build_object('ativo',ativo,'somente_pix',somente_pix,"
        "'monitor_confiabilidade_ativo',monitor_confiabilidade_ativo,'comercios_piloto',comercios_piloto) "
        "FROM public.catalogo_fluxo_config WHERE id=true LIMIT 1)"
    )
    return "SELECT jsonb_build_object(" + ",".join(pieces) + ") AS snapshot LIMIT 1;"


def root_query() -> str:
    return (
        "SELECT id::text,email,(email_confirmed_at IS NOT NULL) AS email_confirmed,"
        "(banned_until IS NULL) AS not_banned FROM auth.users "
        f"WHERE id={sql_literal(ROOT_ADMIN)}::uuid LIMIT 1;"
    )


def rows_with_key(cli: CliResult, key: str) -> list[dict[str, Any]]:
    return [row for row in cli.rows if isinstance(row, dict) and key in row]


def first_value(cli: CliResult, key: str) -> Any:
    rows = rows_with_key(cli, key)
    if not rows:
        raise TestFailure(f"{cli.label}: retorno sem coluna {key!r}: {json_text(cli.rows)[:800]}")
    return rows[0][key]


def rpc_values(cli: CliResult) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows_with_key(cli, "result"):
        value = row["result"]
        if isinstance(value, dict):
            out.append(value)
    return out


def assert_rpc_success(cli: CliResult, label: str) -> list[dict[str, Any]]:
    values = rpc_values(cli)
    if not values:
        raise TestFailure(f"{label}: RPC não retornou objeto JSON: {json_text(cli.rows)[:1000]}")
    failures = [v for v in values if v.get("ok") is not True]
    if failures:
        raise TestFailure(f"{label}: RPC de preparação falhou: {json_text(failures)[:1200]}")
    return values


def detect_permission(text: str) -> bool:
    lowered = text.lower()
    return any(
        marker in lowered
        for marker in (
            "permission denied",
            "insufficient privilege",
            "not authorized",
            "unauthorized",
            "access denied",
        )
    )


def parse_result_file(path: Path, label: str, query: str, stdout: str, stderr: str, returncode: int, elapsed: float) -> CliResult:
    if not path.is_file():
        raise TestFailure(f"{label}: arquivo de resultado CLI ausente: {path}")
    content = path.read_text(encoding="utf-8")
    if content.lstrip().startswith("Error:"):
        if detect_permission(content): raise PermissionFailure(f"{label}: permissão recusada")
        raise TestFailure(f"{label}: erro SQL: {content[:1600]}")
    raw = json.loads(content)
    if detect_permission(json.dumps(raw, ensure_ascii=False)):
        raise PermissionFailure(f"{label}: falha de permissão retornada pelo Supabase")
    result = raw.get("result")
    if not isinstance(result, str):
        # Alguns erros do host vêm como objeto estruturado. Não executar nem interpretar
        # texto de dados como instrução; somente reportar a forma do erro.
        raise TestFailure(f"{label}: envelope CLI sem result string: {json_text(raw)[:1200]}")
    # O texto introdutório também cita o marcador; exigir início de linha e o
    # mesmo UUID no fechamento captura somente o envelope real de rows.
    boundary = re.search(r"(?:^|\n)<untrusted-data-([0-9a-f-]+)>\s*(.*?)\s*</untrusted-data-\1>", result, re.DOTALL)
    if not boundary:
        if detect_permission(result):
            raise PermissionFailure(f"{label}: falha de permissão no retorno SQL")
        raise TestFailure(f"{label}: result string sem envelope untrusted-data")
    payload_text = boundary.group(2).strip()
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise TestFailure(f"{label}: JSON de rows inválido no retorno CLI: {exc}") from exc
    if not isinstance(payload, list):
        raise TestFailure(f"{label}: payload de rows não é lista")
    if returncode != 0:
        raise TestFailure(f"{label}: CLI terminou com código {returncode}: {stderr[-800:]}")
    return CliResult(
        label=label,
        query=query,
        rows=payload,
        result_file=str(path),
        stdout_tail=stdout[-1600:],
        stderr_tail=stderr[-1600:],
        returncode=returncode,
        elapsed_seconds=elapsed,
    )


class NativeCli:
    def __init__(self, project: str, progress: list[str]):
        self.project = project
        self.progress = progress
        self.seq = 0
        self.temp_dir = Path(tempfile.mkdtemp(prefix="qa_concorrencia_"))

    def _unique_paths(self, label: str) -> tuple[Path, Path]:
        self.seq += 1
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)[:80]
        input_path = self.temp_dir / f"input_{self.seq:04d}_{safe}.json"
        requested_result_path = self.temp_dir / f"result_{self.seq:04d}_{safe}.json"
        return input_path, requested_result_path

    async def spawn(self, query: str, label: str) -> ChildHandle:
        input_path, requested_result_path = self._unique_paths(label)
        input_path.write_text(
            json.dumps({"project_id": self.project, "query": query}, ensure_ascii=False), encoding="utf-8"
        )
        env = os.environ.copy()
        # O runtime do host pode escolher seu próprio capture path; ainda assim cada
        # Popen recebe ambos os nomes exigidos, sem compartilhar um caminho solicitado.
        env["MANUS_MCP_RESULT_PATH"] = str(requested_result_path)
        env["MANUS_MCP_RESULT_FILEPATH"] = str(requested_result_path)
        process = await asyncio.create_subprocess_exec(
            CLI,
            "--server",
            "supabase",
            "tool",
            "call",
            "execute_sql",
            "--input-file",
            str(input_path),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        return ChildHandle(label, query, input_path, requested_result_path, process, time.monotonic())

    async def wait(self, handle: ChildHandle, timeout: float = CASE_TIMEOUT_SECONDS) -> CliResult:
        try:
            stdout_b, stderr_b = await asyncio.wait_for(handle.process.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            handle.process.kill()
            await handle.process.communicate()
            raise TestFailure(f"{handle.label}: timeout após {timeout}s") from exc
        stdout = stdout_b.decode("utf-8", errors="replace")
        stderr = stderr_b.decode("utf-8", errors="replace")
        elapsed = time.monotonic() - handle.started_at
        paths = re.findall(r"Tool execution result saved to:\s*(\S+)", stdout + "\n" + stderr)
        # Em modos de execução que não imprimem a linha, aceite somente um caminho
        # absoluto JSON reportado pelo próprio CLI, nunca um caminho de dados retornado.
        if paths:
            result_path = Path(paths[-1])
        else:
            candidates = re.findall(r"/(?:[^\s\"']+\.json)", stdout + "\n" + stderr)
            result_path = Path(candidates[-1]) if candidates else handle.requested_result_path
        try:
            cli = parse_result_file(result_path, handle.label, handle.query, stdout, stderr, handle.process.returncode or 0, elapsed)
        finally:
            handle.input_path.unlink(missing_ok=True)
            if handle.requested_result_path != result_path:
                handle.requested_result_path.unlink(missing_ok=True)
        self.progress.append(f"{handle.label}: OK em {elapsed:.2f}s (resultado={result_path})")
        return cli

    async def call(self, query: str, label: str, timeout: float = CASE_TIMEOUT_SECONDS) -> CliResult:
        handle = await self.spawn(query, label)
        return await self.wait(handle, timeout)

    def close(self) -> None:
        # Somente remove os arquivos temporários de controle criados pelo script.
        for path in self.temp_dir.glob("*"):
            path.unlink(missing_ok=True)
        self.temp_dir.rmdir()


def namespace_from_nonce(nonce: str) -> Namespace:
    owner = uuid_text()
    rider_a = uuid_text()
    rider_b = uuid_text()
    return Namespace(
        nonce=nonce,
        commerce=f"qa-{nonce}",
        owner=owner,
        rider_a=rider_a,
        rider_b=rider_b,
        root=ROOT_ADMIN,
        owner_email=f"qa-owner-{nonce}@example.invalid",
        rider_a_email=f"qa-rider-a-{nonce}@example.invalid",
        rider_b_email=f"qa-rider-b-{nonce}@example.invalid",
        root_email=f"qa{nonce}@example.invalid",
    )


def setup_query(ns: Namespace) -> str:
    users = [
        (ns.owner, ns.owner_email),
        (ns.rider_a, ns.rider_a_email),
        (ns.rider_b, ns.rider_b_email),
    ]
    values = []
    for uid, email in users:
        values.append(
            f"({sql_literal(uid)}::uuid,{sql_literal(email)},now(),NULL,'authenticated',false,false)"
        )
    # Root só entra aqui se o probe anterior confirmou ausência; ON CONFLICT é uma
    # segunda barreira que não altera um root preexistente.
    root_insert = ""
    if ns.root_created:
        root_insert = (
            "INSERT INTO auth.users(id,email,email_confirmed_at,banned_until,role,is_anonymous,is_sso_user) VALUES "
            f"({sql_literal(ns.root)}::uuid,{sql_literal(ns.root_email)},now(),NULL,'authenticated',false,false) "
            "ON CONFLICT (id) DO NOTHING;"
        )
    return "\n".join(
        [
            "BEGIN;",
            root_insert,
            "INSERT INTO auth.users(id,email,email_confirmed_at,banned_until,role,is_anonymous,is_sso_user) VALUES "
            + ",".join(values)
            + ";",
            "INSERT INTO public.comercios_publicados(local_id,status,solicitante_id,dados) VALUES "
            f"({sql_literal(ns.commerce)},'ativo',{sql_literal(ns.owner)}::uuid,"
            "jsonb_build_object('qa_fixture',true,'oauth_receiver',NULL,'vitrine_ativa',false));",
            "INSERT INTO public.catalogos(comercio_id,proprietario_id,modalidades,metodos_pagamento,bloqueado) VALUES "
            f"({sql_literal(ns.commerce)},{sql_literal(ns.owner)}::uuid,ARRAY['entrega']::text[],ARRAY['pix']::text[],false);",
            "INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,ativo,autorizado_por) VALUES "
            f"({sql_literal(ns.commerce)},{sql_literal(ns.rider_a)}::uuid,'QA Rider A',{sql_literal(ns.rider_a_email)},true,{sql_literal(ns.owner)}::uuid),"
            f"({sql_literal(ns.commerce)},{sql_literal(ns.rider_b)}::uuid,'QA Rider B',{sql_literal(ns.rider_b_email)},true,{sql_literal(ns.owner)}::uuid);",
            "INSERT INTO public.catalogo_motoboy_perfis(usuario_id,disponivel,apto,em_analise,chave_pix_enc) VALUES "
            f"({sql_literal(ns.rider_a)}::uuid,true,true,false,NULL),({sql_literal(ns.rider_b)}::uuid,true,true,false,NULL);",
            "COMMIT;",
            "SELECT jsonb_build_object('namespace'," + sql_literal(ns.commerce) + ", 'root_created'," + ("true" if ns.root_created else "false") + ") AS marker LIMIT 1;",
        ]
    )


def order_seed_query(ns: Namespace, case: str, order_id: str, payment_ref: str, status_hash: str) -> str:
    ns.orders[case] = order_id
    ns.payment_refs[case] = payment_ref
    ns.status_hashes[case] = status_hash
    # R$100 = 10000 centavos, entrega fixa QA de 300, taxas 500+200=700.
    columns = (
        "id,comercio_id,referencia_externa,idempotency_key,provedor,status,status_pagamento,"
        "modalidade,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,"
        "taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,repasse_bruto_comercio_centavos,"
        "cliente_nome,cliente_telefone,cliente_endereco,observacoes,codigo_entrega_hash,codigo_entrega_expira_em,"
        "status_token_hash,versao_financeira,entrega_status,metadata"
    )
    values = (
        f"{sql_literal(order_id)}::uuid,{sql_literal(ns.commerce)},{sql_literal('QA_ORDER_' + ns.nonce + '_' + case)},"
        f"{sql_literal(uuid_text())}::uuid,'mercadopago','aguardando_pagamento','pendente','entrega','pix',"
        "10000,300,10300,500,200,700,9600,"
        "'QA Cliente','32999999999','QA Rua 1','QA fixture sem PII real',"
        f"{sql_literal(sha256_hex('QA_CODE_' + ns.nonce + '_' + case))},now()+interval '1 day',"
        f"{sql_literal(status_hash)},2,'nao_atribuido',"
        "jsonb_build_object('qa_fixture',true,'external_transfer',false,'payment_reference'," + sql_literal(payment_ref) + ")"
    )
    # status_token_hash is deliberately a hash fixture, never a real customer token.
    if case == "accept_cancel":
        values=values.replace("'mercadopago','aguardando_pagamento','pendente','entrega','pix'", "'offline','aguardando_pagamento','pendente','entrega','dinheiro'")
    return tx_body(
        [
            f"INSERT INTO public.catalogo_pedidos({columns}) VALUES ({values});",
            "INSERT INTO public.catalogo_pedido_itens(pedido_id,nome_produto,descricao_produto,preco_unitario_centavos,quantidade,total_item_centavos) VALUES "
            f"({sql_literal(order_id)}::uuid,'QA fixture SKU R$100','Produto fictício de teste',10000,1,10000);",
        ],
        marker=f"seed_{case}",
    )


def prepare_ready_query(ns: Namespace, case: str) -> str:
    order_id = ns.orders[case]
    ref = ns.payment_refs[case]
    statements = [
        qrpc(
            "catalogo_aplicar_pagamento_v2",
            [sql_literal(order_id) + "::uuid", sql_literal("approved"), "10300", "700", sql_literal(ref)],
        ),
        qrpc(
            "catalogo_operar_pedido_v2",
            [sql_literal(ns.owner) + "::uuid", sql_literal(ns.commerce), sql_literal(order_id) + "::uuid", sql_literal("aceitar"), "NULL::uuid", sql_literal("QA preparar")],
        ),
        qrpc(
            "catalogo_operar_pedido_v2",
            [sql_literal(ns.owner) + "::uuid", sql_literal(ns.commerce), sql_literal(order_id) + "::uuid", sql_literal("pronto"), "NULL::uuid", sql_literal("QA preparar")],
        ),
    ]
    return tx_body(statements, marker=f"ready_{case}")


def prepare_delivered_query(ns: Namespace, case: str) -> str:
    order_id = ns.orders[case]
    rider = ns.rider_a
    statements = [
        qrpc(
            "catalogo_motoboy_acao_v2",
            [sql_literal(rider) + "::uuid", sql_literal("aceitar_entrega"), sql_literal(order_id) + "::uuid", "NULL::boolean", "NULL::text", "NULL::text", "NULL::text"],
        ),
        qrpc(
            "catalogo_motoboy_acao_v2",
            [sql_literal(rider) + "::uuid", sql_literal("coletar"), sql_literal(order_id) + "::uuid", "NULL::boolean", "NULL::text", "NULL::text", "NULL::text"],
        ),
        qrpc(
            "catalogo_motoboy_acao_v2",
            [sql_literal(rider) + "::uuid", sql_literal("em_entrega"), sql_literal(order_id) + "::uuid", "NULL::boolean", "NULL::text", "NULL::text", "NULL::text"],
        ),
        qrpc(
            "catalogo_confirmar_entrega_motoboy",
            [sql_literal(rider) + "::uuid", sql_literal(ns.commerce), sql_literal(order_id) + "::uuid", sql_literal(sha256_hex("QA_CODE_" + ns.nonce + "_" + case))],
        ),
    ]
    return tx_body(statements, marker=f"delivered_{case}")


def race_state_query(ns: Namespace, case: str) -> str:
    oid = ns.orders[case]
    oid_lit = sql_literal(oid)
    if case == "claim_claim":
        return (
            "SELECT jsonb_build_object("
            "'pedido',(SELECT jsonb_build_object('status',status,'entrega_status',entrega_status,'status_pagamento',status_pagamento) "
            f"FROM public.catalogo_pedidos WHERE id={oid_lit}::uuid LIMIT 1),"
            "'assignment_count',(SELECT count(*)::int FROM public.catalogo_entregas_atribuidas WHERE pedido_id=" + oid_lit + "::uuid LIMIT 1),"
            "'assigned_rider',(SELECT motoboy_id::text FROM public.catalogo_entregas_atribuidas WHERE pedido_id=" + oid_lit + "::uuid LIMIT 1),"
            "'claim_occurrences',(SELECT count(*)::int FROM public.catalogo_ocorrencias_v2 WHERE pedido_id=" + oid_lit + "::uuid LIMIT 1)"
            ") AS state LIMIT 1;"
        )
    if case == "accept_cancel":
        return (
            "SELECT jsonb_build_object("
            "'pedido',(SELECT jsonb_build_object('status',status,'entrega_status',entrega_status,'status_pagamento',status_pagamento,'aceito_em',aceito_em IS NOT NULL) "
            f"FROM public.catalogo_pedidos WHERE id={oid_lit}::uuid LIMIT 1),"
            "'platform_ledger_count',(SELECT count(*)::int FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=" + oid_lit + "::uuid AND tipo='comissao_plataforma' LIMIT 1),"
            "'cancel_occurrence_count',(SELECT count(*)::int FROM public.catalogo_ocorrencias_v2 WHERE pedido_id=" + oid_lit + "::uuid AND origem='comprador' LIMIT 1)"
            ") AS state LIMIT 1;"
        )
    if case == "payout_payout":
        return (
            "SELECT jsonb_build_object("
            "'pedido',(SELECT jsonb_build_object('status',status,'entrega_status',entrega_status,'status_pagamento',status_pagamento) "
            f"FROM public.catalogo_pedidos WHERE id={oid_lit}::uuid LIMIT 1),"
            "'remuneracao',(SELECT jsonb_build_object('status',status,'valor_centavos',valor_centavos,'repasse_id',repasse_id::text,'financiamento_comprovado',financiamento_comprovado) "
            f"FROM public.catalogo_remuneracoes_v2 WHERE pedido_id={oid_lit}::uuid LIMIT 1),"
            "'repasse_count',(SELECT count(*)::int FROM public.catalogo_repasses_v2 WHERE referencia LIKE " + sql_literal("QA_RACE_" + ns.nonce + "_payout_payout_%") + " LIMIT 1),"
            "'paid_ledger_count',(SELECT count(*)::int FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=" + oid_lit + "::uuid AND tipo='remuneracao_motoboy' AND status='pago' LIMIT 1)"
            ") AS state LIMIT 1;"
        )
    if case == "webhook_refund_payout":
        return (
            "SELECT jsonb_build_object("
            "'pedido',(SELECT jsonb_build_object('status',status,'entrega_status',entrega_status,'status_pagamento',status_pagamento,'reembolso_pendente',reembolso_pendente) "
            f"FROM public.catalogo_pedidos WHERE id={oid_lit}::uuid LIMIT 1),"
            "'pagamento',(SELECT jsonb_build_object('status',status,'referencia',referencia) "
            f"FROM public.catalogo_pagamentos_v2 WHERE pedido_id={oid_lit}::uuid LIMIT 1),"
            "'remuneracao',(SELECT jsonb_build_object('status',status,'valor_centavos',valor_centavos,'repasse_id',repasse_id::text,'financiamento_comprovado',financiamento_comprovado) "
            f"FROM public.catalogo_remuneracoes_v2 WHERE pedido_id={oid_lit}::uuid LIMIT 1),"
            "'repasse_count',(SELECT count(*)::int FROM public.catalogo_repasses_v2 WHERE referencia LIKE " + sql_literal("QA_RACE_" + ns.nonce + "_webhook_refund_payout_%") + " LIMIT 1),"
            "'pending_ledger_count',(SELECT count(*)::int FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=" + oid_lit + "::uuid AND tipo='pendencia_revisao' LIMIT 1),"
            "'available_ledger_count',(SELECT count(*)::int FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=" + oid_lit + "::uuid AND status='disponivel' LIMIT 1),"
            "'refund_event_count',(SELECT count(*)::int FROM public.catalogo_pagamento_eventos_v2 WHERE pedido_id=" + oid_lit + "::uuid AND status='estornado' LIMIT 1)"
            ") AS state LIMIT 1;"
        )
    raise ValueError(case)


def observer_query(tag: str) -> str:
    # SELECT explícito e limitado; inclui count, wait_event_type e pid solicitados.
    tag_lit = sql_literal("%" + tag + "%")
    return (
        "SELECT jsonb_build_object("
        "'active_count',(SELECT count(*)::int FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE " + tag_lit + " LIMIT 1),"
        "'lock_wait_count',(SELECT count(*)::int FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE " + tag_lit + " LIMIT 1),"
        "'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'state',state,'wait_event_type',wait_event_type,'wait_event',wait_event) ORDER BY pid),'[]'::jsonb) "
        "FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE " + tag_lit + " LIMIT 20)"
        ") AS observation LIMIT 1;"
    )


def race_sql(ns: Namespace, case: str, actor: str, tag: str) -> str:
    oid = ns.orders[case]
    common_prefix = f"/* {tag} */ "
    if case == "claim_claim":
        rpc = qrpc(
            "catalogo_motoboy_acao_v2",
            [sql_literal(actor) + "::uuid", sql_literal("aceitar_entrega"), sql_literal(oid) + "::uuid", "NULL::boolean", "NULL::text", "NULL::text", "NULL::text"],
        )
    elif case == "accept_cancel":
        if actor == "accept":
            rpc = qrpc(
                "catalogo_operar_pedido_v2",
                [sql_literal(ns.owner) + "::uuid", sql_literal(ns.commerce), sql_literal(oid) + "::uuid", sql_literal("aceitar"), "NULL::uuid", sql_literal("QA race aceitar")],
            )
        else:
            rpc = qrpc(
                "catalogo_cancelar_comprador_v2",
                [sql_literal(oid) + "::uuid", sql_literal(ns.status_hashes[case]), sql_literal("QA race cancelar")],
            )
    elif case == "payout_payout":
        ref = f"QA_RACE_{ns.nonce}_{case}_{actor}"
        ns.race_refs[ref] = case
        rpc = qrpc(
            "catalogo_operacao_admin_v2",
            [sql_literal(ns.root) + "::uuid", sql_literal("registrar_repasse"), "NULL::uuid", "NULL::text", "NULL::text", sql_literal(ns.rider_a) + "::uuid", "ARRAY[" + sql_literal(oid) + "::uuid]::uuid[]", sql_literal(ref), sql_literal("QA fixture: não é transferência real")],
        )
    elif case == "webhook_refund_payout":
        if actor == "payout":
            ref = f"QA_RACE_{ns.nonce}_{case}_payout"
            ns.race_refs[ref] = case
            rpc = qrpc(
                "catalogo_operacao_admin_v2",
                [sql_literal(ns.root) + "::uuid", sql_literal("registrar_repasse"), "NULL::uuid", "NULL::text", "NULL::text", sql_literal(ns.rider_a) + "::uuid", "ARRAY[" + sql_literal(oid) + "::uuid]::uuid[]", sql_literal(ref), sql_literal("QA fixture: não é transferência real")],
            )
        else:
            rpc = qrpc(
                "catalogo_aplicar_pagamento_v2",
                [sql_literal(oid) + "::uuid", sql_literal("refunded"), "10300", "700", sql_literal(ns.payment_refs[case])],
            )
    else:
        raise ValueError(case)
    call=rpc.removeprefix("SELECT ").removesuffix(" AS result LIMIT 1;")
    key="qa"+ns.nonce+"."+case+"_"+str(actor).replace("-","")
    # Retém o lock e retorna o resultado da RPC depois do COMMIT, em uma mesma conexão.
    return (
        f"{common_prefix}BEGIN;\n"
        f"{common_prefix}SELECT set_config({sql_literal(key)},({call})::text,false) LIMIT 1;\n"
        f"{common_prefix}SELECT pg_sleep({DB_SLEEP_SECONDS}) LIMIT 1;\n"
        f"{common_prefix}COMMIT;\n"
        f"WITH saved AS MATERIALIZED (SELECT current_setting({sql_literal(key)})::jsonb AS result LIMIT 1) SELECT saved.result,set_config({sql_literal(key)},'',false) AS cleared FROM saved LIMIT 1;"
    )


def setup_check_query(ns: Namespace) -> str:
    ids = ",".join(sql_literal(x) + "::uuid" for x in (ns.owner, ns.rider_a, ns.rider_b))
    return (
        "SELECT jsonb_build_object("
        "'users',(SELECT count(*)::int FROM auth.users WHERE id=ANY(ARRAY[" + ids + "]::uuid[]) LIMIT 1),"
        "'commerce',(SELECT count(*)::int FROM public.catalogos WHERE comercio_id=" + sql_literal(ns.commerce) + " LIMIT 1),"
        "'motoboys',(SELECT count(*)::int FROM public.catalogo_motoboys WHERE comercio_id=" + sql_literal(ns.commerce) + " AND usuario_id=ANY(ARRAY[" + ids + "]::uuid[]) LIMIT 1),"
        "'profiles',(SELECT count(*)::int FROM public.catalogo_motoboy_perfis WHERE usuario_id=ANY(ARRAY[" + sql_literal(ns.rider_a) + "::uuid," + sql_literal(ns.rider_b) + "::uuid]::uuid[]) LIMIT 1),"
        "'ciphertexts',(SELECT count(*)::int FROM public.catalogo_motoboy_perfis WHERE usuario_id=ANY(ARRAY[" + sql_literal(ns.rider_a) + "::uuid," + sql_literal(ns.rider_b) + "::uuid]::uuid[]) AND chave_pix_enc IS NOT NULL LIMIT 1)"
        ") AS setup LIMIT 1;"
    )


def cleanup_query(ns: Namespace) -> str:
    order_array = "ARRAY[" + ",".join(sql_literal(v) + "::uuid" for v in ns.orders.values()) + "]::uuid[]"
    user_array = "ARRAY[" + ",".join(sql_literal(v) + "::uuid" for v in (ns.owner, ns.rider_a, ns.rider_b)) + "]::uuid[]"
    refs = list(ns.race_refs.keys())
    refs_sql = "ARRAY[" + ",".join(sql_literal(v) for v in refs) + "]::text[]" if refs else "ARRAY[]::text[]"
    statements = [
        f"DELETE FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=ANY({order_array}) OR remuneracao_id IN (SELECT id FROM public.catalogo_remuneracoes_v2 WHERE pedido_id=ANY({order_array}) LIMIT 1000);",
        f"DELETE FROM public.catalogo_logistica_offline_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_fatura_componentes_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_remuneracoes_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_repasses_v2 WHERE referencia=ANY({refs_sql}) AND motoboy_id={sql_literal(ns.rider_a)}::uuid;",
        f"DELETE FROM public.catalogo_pagamento_eventos_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_pagamentos_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_comissoes_offline WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_ocorrencias_v2 WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_entregas_atribuidas WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_entregas_gestao_eventos WHERE comercio_id={sql_literal(ns.commerce)};",
        f"DELETE FROM public.catalogo_pedido_eventos WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_pedido_itens WHERE pedido_id=ANY({order_array});",
        f"DELETE FROM public.catalogo_pedidos WHERE id=ANY({order_array}) AND comercio_id={sql_literal(ns.commerce)};",
        f"DELETE FROM public.catalogo_motoboy_perfis WHERE usuario_id=ANY(ARRAY[{sql_literal(ns.rider_a)}::uuid,{sql_literal(ns.rider_b)}::uuid]::uuid[]);",
        f"DELETE FROM public.catalogo_motoboys WHERE comercio_id={sql_literal(ns.commerce)} AND usuario_id=ANY(ARRAY[{sql_literal(ns.rider_a)}::uuid,{sql_literal(ns.rider_b)}::uuid]::uuid[]);",
        f"DELETE FROM public.catalogos WHERE comercio_id={sql_literal(ns.commerce)} AND proprietario_id={sql_literal(ns.owner)}::uuid;",
        f"DELETE FROM public.comercios_publicados WHERE local_id={sql_literal(ns.commerce)} AND solicitante_id={sql_literal(ns.owner)}::uuid;",
        f"DELETE FROM auth.users WHERE id=ANY({user_array}) AND email=ANY(ARRAY[{sql_literal(ns.owner_email)},{sql_literal(ns.rider_a_email)},{sql_literal(ns.rider_b_email)}]::text[]);",
    ]
    if ns.root_created:
        statements.append(f"DELETE FROM auth.users WHERE id={sql_literal(ns.root)}::uuid AND email={sql_literal(ns.root_email)};")
    return tx_body(statements, marker="cleanup_qa_namespace")


def state_from(cli: CliResult, key: str) -> dict[str, Any]:
    value = first_value(cli, key)
    if not isinstance(value, dict):
        raise TestFailure(f"{cli.label}: {key} não é objeto JSON")
    return value


def classify_race(case: str, children: list[CliResult], overlap: dict[str, Any], state: dict[str, Any]) -> str:
    active = int(overlap.get("active_count") or 0)
    locks = int(overlap.get("lock_wait_count") or 0)
    if active < 2 or locks < 1:
        return "sem_prova_multisessao (observer não viu 2 sessões ativas e lock wait)"
    values = [v for child in children for v in rpc_values(child)]
    oks = [v for v in values if v.get("ok") is True]
    losers = [v for v in values if v.get("ok") is not True]
    if case == "claim_claim":
        if len(oks) == 1 and len(losers) == 1 and losers[0].get("http_status") == 409 and state.get("assignment_count") == 1:
            return "PASS: um claim venceu, o outro recebeu 409 e há exatamente uma atribuição"
        return "FAIL: resultado de claim não foi exclusivo/coerente"
    if case == "accept_cancel":
        order = state.get("pedido") or {}
        if len(oks) != 1 or not any(v.get("http_status") == 409 for v in losers):
            return "FAIL: aceite/cancelamento não teve exatamente um vencedor e um 409"
        if order.get("status") == "cancelado" and state.get("platform_ledger_count") == 0 and state.get("cancel_occurrence_count") == 1:
            return "PASS: cancelamento venceu sem aceitar nem criar comissão contraditória"
        if order.get("status") == "em_preparo" and state.get("platform_ledger_count") == 1 and state.get("cancel_occurrence_count") == 0:
            return "PASS: aceite venceu com uma comissão e cancelamento foi recusado"
        return "FAIL: estado final de aceite/cancelamento incoerente"
    if case == "payout_payout":
        if len(oks) == 1 and len(losers) == 1 and losers[0].get("http_status") == 409 and (state.get("remuneracao") or {}).get("status") == "pago" and state.get("repasse_count") == 1 and state.get("paid_ledger_count") == 1 and oks[0].get("transferencia_executada") is False:
            return "PASS: só um repasse registrado, retry 409 e transferência externa false"
        return "FAIL: payout concorrente duplicou ou não preservou idempotência"
    if case == "webhook_refund_payout":
        order = state.get("pedido") or {}
        rem = state.get("remuneracao") or {}
        if any(v.get("transferencia_executada") is True for v in values):
            return "FAIL: retorno indicou transferência externa verdadeira"
        payout_won = any(v.get("ok") is True and "repasse_id" in v for v in values)
        if payout_won and rem.get("status") == "pendencia_revisao" and rem.get("repasse_id") and state.get("repasse_count") == 1 and state.get("pending_ledger_count") == 1 and state.get("available_ledger_count") == 0 and state.get("refund_event_count") == 1 and order.get("entrega_status") == "entregue":
            return "PASS: payout venceu, prova preservada e uma pendência de revisão foi criada"
        if not payout_won and rem.get("status") == "estornado" and not rem.get("repasse_id") and state.get("repasse_count") == 0 and state.get("available_ledger_count") == 0 and state.get("refund_event_count") == 1:
            return "PASS: estorno venceu, nenhum repasse foi registrado e não há crédito disponível"
        return "FAIL: refund/payout não deixou crédito estornado e pendência única coerentes"
    return "FAIL: caso desconhecido"


async def run_race(cli: NativeCli, ns: Namespace, case: str, actor_a: str, actor_b: str, stagger: float = 0.0) -> RaceResult:
    tag = f"QA_RACE_{ns.nonce}_{case}"
    print(f"[progress] iniciando {case}: dois Popen com tag {tag}", flush=True)
    first = await cli.spawn(race_sql(ns, case, actor_a, tag), f"{case}-child-a")
    if stagger:
        await asyncio.sleep(stagger)
    second = await cli.spawn(race_sql(ns, case, actor_b, tag), f"{case}-child-b")
    await asyncio.sleep(2.0)
    observer_task = asyncio.create_task(cli.call(observer_query(tag), f"{case}-observer", timeout=30))
    child_results = await asyncio.gather(cli.wait(first), cli.wait(second), return_exceptions=True)
    observer_result = await observer_task
    child_errors = [x for x in child_results if isinstance(x, BaseException)]
    for error in child_errors:
        if isinstance(error, PermissionFailure):
            raise error
    children = [x for x in child_results if isinstance(x, CliResult)]
    overlap = state_from(observer_result, "observation")
    state_cli = await cli.call(race_state_query(ns, case), f"{case}-state")
    state = state_from(state_cli, "state")
    error_text = "; ".join(str(x) for x in child_errors) if child_errors else None
    classification = classify_race(case, children, overlap, state) if not error_text else f"FAIL: erro nos filhos: {error_text}"
    return RaceResult(case, tag, children, observer_result, overlap, state, classification, error_text)


def md_json(value: Any) -> str:
    return "```json\n" + json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n```"


def render_report(data: dict[str, Any]) -> str:
    lines = [
        "# Concorrência real — PostgreSQL staging entregas v2",
        "",
        f"- **Gerado em:** {data.get('finished_at', 'n/d')}",
        f"- **Projeto autorizado:** `{STAGING_PROJECT}`",
        f"- **Script:** `{SCRIPT_PATH}`",
        "- **Escopo:** somente staging; nenhum projeto de produção, OAuth, segredo, pagamento externo ou transferência foi acessado.",
        "- **Pagamento fixture:** SKU QA de R$100 (`10000` centavos), entrega `300`, taxas `500 + 200 = 700`; referência `QA_NOT_REAL_MONEY_*`.",
        "- **Transferências:** as RPCs retornaram/foram verificadas com `transferencia_executada=false`; este experimento **não afirma Pix split real**.",
        "",
        "## Controles de segurança e namespace",
        f"- `--allow-staging`: `{data.get('allow_staging')}`; project id validado contra constante staging.",
        f"- Namespace: `{data.get('commerce', 'n/d')}`; todos os IDs e e-mails sintéticos são UUID4/`example.invalid`.",
        f"- Root admin `{ROOT_ADMIN}`: `{data.get('root_admin', {})}`. Se criado, foi criado somente com e-mail QA confirmado, sem senha/OTP; nunca foi alterado.",
        "- Perfis de motoboy foram criados com `chave_pix_enc = NULL`; não houve segredo criptográfico salvo.",
        "- O comércio QA foi publicado sem recebedor OAuth/token e sem assinatura ativa; não foi colocado em vitrine ativa.",
        "",
        "## Comandos executados",
        "Cada chamada foi feita pelo Native CLI, com JSON `{project_id, query}` e arquivo de resultado separado por Popen:",
        "```text",
        "manus-mcp-cli --server supabase tool call execute_sql --input-file <JSON-por-child>",
        "```",
        "Cada participante de race executou esta forma, com a tag única `QA_RACE_*` e lock mantido durante 3 s:",
        "```sql",
        "BEGIN;",
        "SELECT public.<rpc>(...) AS result LIMIT 1;",
        "SELECT pg_sleep(3) LIMIT 1;",
        "COMMIT;",
        "```",
        "O terceiro Popen observou somente colunas necessárias em `pg_stat_activity`:",
        "```sql",
        "SELECT pid, state, wait_event_type, wait_event FROM pg_stat_activity",
        "WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%QA_RACE_%' LIMIT 20;",
        "```",
        "",
        "## Controles before/after",
        f"- **Before:**\n{md_json(data.get('before'))}",
        f"- **After cleanup:**\n{md_json(data.get('after'))}",
        f"- **Contagens restauradas:** `{data.get('counts_equal')}`.",
        f"- **Config permaneceu desligada:** `{data.get('config_unchanged')}`.",
        "",
        "## Races",
    ]
    races = data.get("races", [])
    if not races:
        lines.append("Nenhuma race completou; o motivo está em **Falhas/caveats**.")
    for race in races:
        lines.extend(
            [
                f"### {race['case']}",
                f"- Tag: `{race['tag']}`",
                f"- **Classificação:** {race['classification']}",
                f"- Observer overlap/lock: {md_json(race['overlap'])}",
                f"- Estado final bounded: {md_json(race['state'])}",
                f"- RPC results dos filhos: {md_json(race.get('rpc_results'))}",
                f"- Arquivos de resultado CLI: {md_json(race.get('result_files'))}",
            ]
        )
    lines.extend(
        [
            "",
            "## Progresso/observabilidade",
            "```text",
            "\n".join(data.get("progress", [])) or "(sem progresso registrado)",
            "```",
            "",
            "## Falhas/caveats",
        ]
    )
    errors = data.get("errors", [])
    if errors:
        lines.extend(f"- {error}" for error in errors)
    else:
        lines.append("- Nenhuma falha controlada registrada.")
    lines.extend(
        [
            "- Resultados foram tratados como dados JSON não confiáveis entre os marcadores `untrusted-data`; nenhuma instrução contida no retorno foi executada.",
            "- Se o observer não registrar simultaneamente `active_count >= 2` e `lock_wait_count >= 1`, a classificação é explicitamente sem prova multissessão; não é convertida em aprovação.",
            "",
        ]
    )
    return "\n".join(lines)


async def execute(args: argparse.Namespace) -> dict[str, Any]:
    progress: list[str] = []
    errors: list[str] = []
    races: list[RaceResult] = []
    ns = namespace_from_nonce(secrets.token_hex(6))
    cli = NativeCli(args.project, progress)
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    root_info: dict[str, Any] = {}
    setup_done = False
    fatal: str | None = None
    try:
        root_cli = await cli.call(root_query(), "root-admin-probe")
        root_rows = [row for row in root_cli.rows if isinstance(row, dict) and row.get("id") == ROOT_ADMIN]
        if root_rows:
            root_info = root_rows[0]
            ns.root_created = False
        else:
            root_info = {"id": ROOT_ADMIN, "preexisting": False, "will_create": True, "email": ns.root_email}
            ns.root_created = True
        before_cli = await cli.call(snapshot_query(), "before-counts")
        before = first_value(before_cli, "snapshot")
        cfg = before.get("config") or {}
        if cfg.get("ativo") is not False or cfg.get("somente_pix") is not False or cfg.get("monitor_confiabilidade_ativo") is not False or cfg.get("comercios_piloto") not in (None, []):
            raise SafetyFailure(f"Config staging não está integralmente off/sem allowlist: {json_text(cfg)}")
        setup_cli = await cli.call(setup_query(ns), "setup-qa-namespace")
        setup_done = True
        setup = first_value(setup_cli, "marker")
        if setup.get("namespace") != ns.commerce:
            raise TestFailure("Setup retornou namespace inesperado")
        check_cli = await cli.call(setup_check_query(ns), "setup-check")
        check = first_value(check_cli, "setup")
        if check.get("users") != 3 or check.get("commerce") != 1 or check.get("motoboys") != 2 or check.get("profiles") != 2 or check.get("ciphertexts") != 0:
            raise TestFailure(f"Fixtures QA não conferem: {json_text(check)}")
        for case in ("claim_claim", "accept_cancel", "payout_payout", "webhook_refund_payout"):
            oid = uuid_text()
            ref = f"QA_NOT_REAL_MONEY_{ns.nonce}_{case}"
            token_hash = sha256_hex(f"QA_STATUS_TOKEN_{ns.nonce}_{case}")
            seed_cli = await cli.call(order_seed_query(ns, case, oid, ref, token_hash), f"seed-{case}")
            seed_marker = first_value(seed_cli, "marker")
            if not isinstance(seed_marker, dict) or seed_marker.get("marker") != f"seed_{case}":
                raise TestFailure(f"Seed retornou marcador inesperado para {case}")
            if case != "accept_cancel":
                ready_cli = await cli.call(prepare_ready_query(ns, case), f"prepare-ready-{case}")
                assert_rpc_success(ready_cli, f"prepare-ready-{case}")
        for case in ("payout_payout", "webhook_refund_payout"):
            delivered_cli = await cli.call(prepare_delivered_query(ns, case), f"prepare-delivered-{case}")
            assert_rpc_success(delivered_cli, f"prepare-delivered-{case}")
        races.append(await run_race(cli, ns, "claim_claim", ns.rider_a, ns.rider_b))
        races.append(await run_race(cli, ns, "accept_cancel", "accept", "cancel"))
        races.append(await run_race(cli, ns, "payout_payout", "payout_a", "payout_b"))
        races.append(await run_race(cli, ns, "webhook_refund_payout", "payout", "refund", stagger=0.60))
    except PermissionFailure as exc:
        fatal = str(exc)
        errors.append(f"STOP por falha de permissão; nenhum bypass foi tentado: {exc}")
    except (SafetyFailure, TestFailure) as exc:
        fatal = str(exc)
        errors.append(str(exc))
    except Exception as exc:
        fatal = f"Erro inesperado: {type(exc).__name__}: {exc}"
        errors.append(fatal)
    finally:
        if setup_done:
            try:
                cleanup_cli = await cli.call(cleanup_query(ns), "cleanup-qa-namespace")
                progress.append(f"cleanup marker={first_value(cleanup_cli, 'marker')}")
            except PermissionFailure as exc:
                errors.append(f"STOP por falha de permissão no cleanup; não houve bypass: {exc}")
            except Exception as exc:
                errors.append(f"Cleanup QA falhou: {type(exc).__name__}: {exc}")
            try:
                after_cli = await cli.call(snapshot_query(), "after-counts")
                after = first_value(after_cli, "snapshot")
            except Exception as exc:
                errors.append(f"Leitura after falhou: {type(exc).__name__}: {exc}")
        cli.close()
    counts_equal = before is not None and after is not None and all(before.get(k) == after.get(k) for k in before.keys())
    config_unchanged = bool(before and after and before.get("config") == after.get("config") and (after.get("config") or {}).get("ativo") is False)
    return {
        "allow_staging": True,
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "commerce": ns.commerce,
        "namespace": ns.__dict__,
        "root_admin": {**root_info, "created_by_this_run": ns.root_created},
        "before": before,
        "after": after,
        "counts_equal": counts_equal,
        "config_unchanged": config_unchanged,
        "races": [
            {
                "case": r.case,
                "tag": r.tag,
                "classification": r.classification,
                "overlap": r.overlap,
                "state": r.state,
                "rpc_results": [rpc_values(c) for c in r.children],
                "result_files": [c.result_file for c in r.children] + ([r.observer.result_file] if r.observer else []),
                "error": r.error,
            }
            for r in races
        ],
        "progress": progress,
        "errors": errors,
        "fatal": fatal,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-staging", action="store_true", required=True, help="confirma explicitamente o único projeto de staging")
    parser.add_argument("--project", default=STAGING_PROJECT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.project != STAGING_PROJECT:
        parser.error("este script aceita somente o projeto de staging autorizado")
    return args


def write_report(data: dict[str, Any]) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(render_report(data), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        data = asyncio.run(execute(args))
    except Exception as exc:
        data = {
            "allow_staging": True,
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "errors": [f"Falha antes da execução assíncrona: {type(exc).__name__}: {exc}"],
            "races": [],
            "progress": [],
            "counts_equal": False,
            "config_unchanged": False,
        }
    write_report(data)
    print(f"Relatório: {REPORT_PATH}")
    print(f"Script: {SCRIPT_PATH}")
    failed = bool(data.get("errors")) or not data.get("counts_equal") or not data.get("config_unchanged") or any(not str(r.get("classification", "")).startswith("PASS:") for r in data.get("races", []))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
