#!/usr/bin/env python3
"""Race two independent PostgreSQL sessions against the real courier-accept RPC.

Works ONLY on the disposable catalogo_race_ci clone, using local libpq/psql.
Locks the same order in a third transaction before issuing BOTH courier RPCs;
waits until both connections are blocked on that lock before releasing it.
No HTTP, no production data, no payments or external services.
"""
import json
import os
import select
import subprocess
import sys
import time

SOURCE_DB = "catalogo_ci"
TEST_DB = "catalogo_race_ci"
ORDER_ID = "00000000-0000-4000-8000-000000000251"
COURIERS = (
    "00000000-0000-4000-8000-000000000241",
    "00000000-0000-4000-8000-000000000242",
)
COMERCIO_ID = "comercio-de-exemplo"
TIMEOUT_SECONDS = 20


def assert_disposable() -> None:
    required = {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGUSER": "postgres",
        "PGDATABASE": SOURCE_DB,
    }
    for variable, expected in required.items():
        if os.environ.get(variable) != expected:
            raise RuntimeError(f"Refusing non-disposable environment: {variable}")
    for variable in ("DATABASE_URL", "PGSERVICE", "PGHOSTADDR", "PGOPTIONS"):
        if os.environ.get(variable):
            raise RuntimeError(f"Unexpected connection override: {variable}")
    if query_one("SELECT current_database()", db=TEST_DB) != TEST_DB:
        raise RuntimeError("Isolated race database does not exist")


def query_one(sql: str, db: str = TEST_DB) -> str:
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql],
        text=True, capture_output=True, check=True, timeout=TIMEOUT_SECONDS
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise AssertionError(f"Expected one SQL row, got {result.stdout!r}")
    return lines[0]


def rpc_json(sql: str):
    return json.loads(query_one(sql))


def courier_action(courier: str, action: str):
    return rpc_json(
        "SELECT public.catalogo_motoboy_acao_v2("
        f"'{courier}'::uuid,'{action}', '{ORDER_ID}'::uuid)::text"
    )


def blocked_workers() -> int:
    return int(query_one(
        "SELECT count(*) FROM pg_stat_activity "
        f"WHERE datname='{TEST_DB}' "
        "AND application_name IN ('catalogo-race-a','catalogo-race-b') "
        "AND wait_event_type='Lock'"
    ))


def race_once(round_number: int) -> str:
    holder = None
    workers = []
    try:
        holder = subprocess.Popen(
            ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1
        )
        holder.stdin.write(
            "BEGIN;\n"
            f"SELECT 'ROW_LOCK_HELD' FROM public.catalogo_pedidos WHERE id='{ORDER_ID}' FOR UPDATE;\n"
        )
        holder.stdin.flush()
        ready, _, _ = select.select([holder.stdout], [], [], TIMEOUT_SECONDS)
        if not ready or holder.stdout.readline().strip() != "ROW_LOCK_HELD":
            raise RuntimeError("Could not establish the blocking row lock")

        for suffix, courier in zip(("a", "b"), COURIERS):
            env = dict(os.environ, PGAPPNAME=f"catalogo-race-{suffix}")
            sql = (
                "SELECT public.catalogo_motoboy_acao_v2("
                f"'{courier}'::uuid, 'aceitar_entrega', '{ORDER_ID}'::uuid)::text"
            )
            workers.append(subprocess.Popen(
                ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-c", sql],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, env=env
            ))

        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline and blocked_workers() < 2:
            for worker in workers:
                if worker.poll() is not None:
                    raise RuntimeError("A courier finished before BOTH sessions were blocked")
            time.sleep(0.12)
        else:
            if blocked_workers() < 2:
                raise RuntimeError("Two simultaneous PostgreSQL lock waits were not observed")

        # Both competing SELECT ... FOR UPDATE calls are waiting on this exact row.
        holder.stdin.write("COMMIT;\n\\q\n")
        holder.stdin.flush()
        holder.wait(timeout=TIMEOUT_SECONDS)
        if holder.returncode != 0:
            raise RuntimeError(f"Row-lock holder exited incorrectly: {holder.stderr.read()}")

        results = []
        for courier, worker in zip(COURIERS, workers):
            stdout, stderr = worker.communicate(timeout=TIMEOUT_SECONDS)
            if worker.returncode != 0:
                raise RuntimeError(f"Courier {courier} failed SQL: {stderr}")
            try:
                results.append((courier, json.loads(stdout.strip())))
            except ValueError as exc:
                raise RuntimeError(f"Unexpected courier SQL output: {stdout!r}") from exc

        success = [(courier, result) for courier, result in results
                   if result.get("ok") is True]
        rejected = [(courier, result) for courier, result in results
                    if result.get("http_status") == 409]
        if len(success) != 1 or len(rejected) != 1:
            raise AssertionError(f"Concurrent acceptance not atomic: {results!r}")

        winner = success[0][0]
        row = query_one(
            "SELECT a.motoboy_id::text || '|' || p.entrega_status "
            "FROM public.catalogo_entregas_atribuidas a "
            "JOIN public.catalogo_pedidos p ON p.id=a.pedido_id "
            f"WHERE a.pedido_id='{ORDER_ID}'"
        )
        if row != winner + "|reservado":
            raise AssertionError(f"Wrong courier reserved the order: {row!r}")

        if query_one("SELECT count(*) FROM public.catalogo_entregas_atribuidas") != "1":
            raise AssertionError("Multiple assignments were created by concurrent acceptance")
        if query_one("SELECT count(*) FROM public.catalogo_remuneracoes_v2") != "0":
            raise AssertionError("Courier credited before physical delivery")

        print(
            f"PASS round {round_number}: two distinct PostgreSQL sessions "
            f"blocked simultaneously, exactly one winner {winner[-3:]}, "
            "other rejected HTTP 409", flush=True
        )
        return winner
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
            worker.communicate()
        if holder is not None:
            if holder.poll() is None:
                holder.kill()
            holder.communicate()



def race_buyer_cancel_vs_merchant_accept(order_id: str, token_digit: str, buyer_first: bool):
    """Force buyer cancellation and merchant acceptance to wait on the SAME row."""
    holder = None
    workers = []
    try:
        holder = subprocess.Popen(
            ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1
        )
        holder.stdin.write(
            "BEGIN;\\n"
            f"SELECT 'ROW_LOCK_HELD' FROM public.catalogo_pedidos WHERE id='{order_id}' FOR UPDATE;\\n"
        )
        holder.stdin.flush()
        ready, _, _ = select.select([holder.stdout], [], [], TIMEOUT_SECONDS)
        if not ready or holder.stdout.readline().strip() != "ROW_LOCK_HELD":
            raise RuntimeError("Could not block order during cancellation/acceptance race")

        contenders = [
            (
                "buyer",
                "SELECT public.catalogo_cancelar_comprador_v2("
                f"'{order_id}'::uuid, repeat('{token_digit}',64), 'CI: cancelamento simultaneo')::text"
            ),
            (
                "merchant",
                "SELECT public.catalogo_operar_pedido_v2("
                "'00000000-0000-4000-8000-000000000099'::uuid,"
                f"'{COMERCIO_ID}', '{order_id}'::uuid, 'aceitar')::text"
            ),
        ]
        if not buyer_first:
            contenders.reverse()

        for label, sql in contenders:
            env = dict(os.environ, PGAPPNAME=f"catalogo-order-{label}")
            workers.append((
                label,
                subprocess.Popen(
                    ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", TEST_DB, "-c", sql],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env
                )
            ))

        deadline = time.monotonic() + TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            waiting = int(query_one(
                "SELECT count(*) FROM pg_stat_activity "
                f"WHERE datname='{TEST_DB}' "
                "AND application_name IN ('catalogo-order-buyer', 'catalogo-order-merchant') "
                "AND wait_event_type='Lock'"
            ))
            if waiting == 2:
                break
            for label, worker in workers:
                if worker.poll() is not None:
                    raise RuntimeError(f"{label} finished before concurrent lock was established")
            time.sleep(0.12)
        else:
            raise RuntimeError("Both buyer and merchant were not observed blocked simultaneously")

        holder.stdin.write("COMMIT;\\n\\\\q\\n")
        holder.stdin.flush()
        holder.wait(timeout=TIMEOUT_SECONDS)
        if holder.returncode != 0:
            raise RuntimeError(f"Cancellation race lock holder failed: {holder.stderr.read()}")

        outputs = {}
        for label, worker in workers:
            stdout, stderr = worker.communicate(timeout=TIMEOUT_SECONDS)
            if worker.returncode != 0:
                raise RuntimeError(f"{label} SQL failure: {stderr}")
            outputs[label] = json.loads(stdout.strip())

        winners = [key for key, result in outputs.items() if result.get("ok") is True]
        losers = [key for key, result in outputs.items() if result.get("http_status") == 409]
        if len(winners) != 1 or len(losers) != 1:
            raise AssertionError(f"Buyer/merchant both won or failed: {outputs!r}")

        state = query_one(
            "SELECT status || '|' || (aceito_em IS NOT NULL)::text || "
            "'|' || reembolso_pendente::text FROM public.catalogo_pedidos "
            f"WHERE id='{order_id}'"
        )
        occurrence_count = int(query_one(
            "SELECT count(*) FROM public.catalogo_ocorrencias_v2 "
            f"WHERE pedido_id='{order_id}' AND categoria='cancelamento_comprador'"
        ))
        platform_count = int(query_one(
            "SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2 "
            f"WHERE pedido_id='{order_id}' AND tipo='comissao_plataforma'"
        ))
        if winners[0] == "buyer":
            if state != "cancelado|false|true" or occurrence_count != 1 or platform_count != 0:
                raise AssertionError(
                    f"Buyer won but cancellation/ledger inconsistent: "
                    f"{state}, {occurrence_count}, {platform_count}"
                )
        else:
            if state != "em_preparo|true|false" or occurrence_count != 0 or platform_count != 1:
                raise AssertionError(
                    f"Merchant won but acceptance/ledger inconsistent: "
                    f"{state}, {occurrence_count}, {platform_count}"
                )

        print(
            f"PASS buyer/merchant {order_id[-3:]}: both sessions waited on row; "
            f"{winners[0]} succeeded and {losers[0]} rejected HTTP 409; "
            "state and financial ledger consistent",
            flush=True,
        )
    finally:
        for _, worker in workers:
            if worker.poll() is None:
                worker.kill()
            worker.communicate()
        if holder is not None:
            if holder.poll() is None:
                holder.kill()
            holder.communicate()


def main():
    assert_disposable()

    first_winner = race_once(1)
    result = courier_action(first_winner, "desistir")
    if result.get("reofertado") is not True:
        raise AssertionError(f"Pre-pickup withdrawal did not reoffer: {result!r}")
    if query_one(
        "SELECT entrega_status FROM public.catalogo_pedidos "
        f"WHERE id='{ORDER_ID}'"
    ) != "ofertado" or query_one(
        "SELECT count(*) FROM public.catalogo_entregas_atribuidas"
    ) != "0":
        raise AssertionError("Withdrawing courier left a stale assignment")

    second_winner = race_once(2)
    loser = next(c for c in COURIERS if c != second_winner)
    if courier_action(loser, "coletar").get("http_status") != 403:
        raise AssertionError("Unassigned courier was allowed to pick up order")
    if courier_action(second_winner, "coletar").get("ok") is not True:
        raise AssertionError("Assigned courier could not collect order")
    if courier_action(second_winner, "em_entrega").get("ok") is not True:
        raise AssertionError("Assigned courier could not start delivery")
    if query_one("SELECT count(*) FROM public.catalogo_remuneracoes_v2") != "0":
        raise AssertionError("Remuneration credited on pickup instead of delivery")

    confirm = rpc_json(
        "SELECT public.catalogo_confirmar_entrega_motoboy("
        f"'{second_winner}'::uuid, '{COMERCIO_ID}', '{ORDER_ID}'::uuid, "
        f"repeat('e',64))::text"
    )
    if confirm.get("ok") is not True or confirm.get("remuneracao_registrada") is not True:
        raise AssertionError(f"Valid delivery after reoffer failed: {confirm!r}")
    if query_one(
        "SELECT count(*) FROM public.catalogo_remuneracoes_v2 "
        f"WHERE pedido_id='{ORDER_ID}' AND valor_centavos=2 "
        "AND status='retido'"
    ) != "1":
        raise AssertionError("Expected exactly one held 2-cent credit after confirmed delivery")
    if query_one("SELECT count(*) FROM public.catalogo_entregas_atribuidas") != "1":
        raise AssertionError("Courier assignment was lost after confirmation")

    print(
        "PASS: two REAL simultaneous acceptance races, withdrawal/reoffer, "
        "exclusive pickup, physical delivery and one held 2% credit",
        flush=True
    )

    # Separate buyer/merchant races on two other fictional orders. Exactly one
    # transition must win; both lock waits are witnessed before either proceeds.
    race_buyer_cancel_vs_merchant_accept(
        "00000000-0000-4000-8000-000000000252", "1", buyer_first=True
    )
    race_buyer_cancel_vs_merchant_accept(
        "00000000-0000-4000-8000-000000000253", "2", buyer_first=False
    )
    if query_one("SELECT count(*) FROM public.catalogo_remuneracoes_v2") != "1":
        raise AssertionError("Buyer/merchant race unexpectedly altered courier credit")
    print(
        "PASS: simultaneous buyer cancellation versus merchant acceptance "
        "without contradictory order states or duplicated commission",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: isolated courier race: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
