#!/usr/bin/env python3
"""Gera payload de migração SOMENTE para o projeto de staging vazio autorizado.
Não consulta/copía contas, pedidos, tokens OAuth, senhas ou secrets de produção.
Não aplica a migração automaticamente. A saída é JSON para apply_migration.
"""
import argparse
import json
import re
from pathlib import Path

STAGING_PROJECT = "jbttwihctuibchhcyqtl"
BASE = """
DO $$ BEGIN
  IF to_regclass('public.catalogos') IS NOT NULL
     OR to_regclass('public.comercios_publicados') IS NOT NULL
     OR to_regclass('public.storage_cleanup_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap recusado: há tabelas da aplicação. Use um staging vazio e não substitua dados/políticas existentes.';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.comercios_publicados (
  local_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'ativo',
  solicitante_id uuid REFERENCES auth.users(id),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.comercios_publicados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comercios_publicados FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.comercios_publicados TO service_role;
CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  bucket_id text NOT NULL
);
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storage_cleanup_queue TO service_role;
"""
RECEIVER = """
CREATE TABLE IF NOT EXISTS public.catalogo_recebedores (
  comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  provedor text NOT NULL DEFAULT 'mercadopago' CHECK (provedor='mercadopago'),
  conta_externa_id text CHECK (conta_externa_id IS NULL OR char_length(trim(conta_externa_id)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_analise','ativo','bloqueado','desconectado')),
  percentual_plataforma numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (percentual_plataforma=5.00),
  conectado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.catalogo_recebedores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_recebedores FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.catalogo_recebedores TO service_role;
"""
FILES = [
    "20261003013323_catalogo_digital_20261003000000.sql",
    "20261004223000_catalogo_marketplace_pedidos.sql",
    "20261005010000_catalogo_marketplace_oauth.sql",
    "20261005090000_catalogo_pedidos_email.sql",
    "20261005120000_catalogo_pagamentos_offline.sql",
    "20261005123000_catalogo_pedidos_offline_auditoria.sql",
    "20261005130000_catalogo_offline_rate_limit.sql",
    "20261005133000_catalogo_marketplace_test_allowlist.sql",
    "20261005150000_catalogo_fechamento_automatico.sql",
    "20261005160000_catalogo_fatura_pix.sql",
    "20261005170000_catalogo_correcao_confirmacao_offline.sql",
    "20261006130000_catalogo_gratuito_por_conexao.sql",
    "20261006175809_confirmacao_entrega_painel.sql",
    "20261006184332_catalogo_motoboys_acesso_restrito.sql",
]

def generate(root: Path, project: str) -> dict:
    if project != STAGING_PROJECT:
        raise ValueError("Este bootstrap só pode ser gerado para staging, nunca para produção.")
    parts = ["-- STAGING: estrutura auxiliar mínima, não clone de dados da aplicação.", BASE]
    for index, name in enumerate(FILES):
        path = root / "supabase" / "migrations" / name
        if not path.is_file():
            raise FileNotFoundError(f"Migração original ausente: {path}")
        sql = path.read_text(encoding="utf-8")
        # Preserva todos os blocos PL/pgSQL: somente BEGIN/COMMIT isolados de transação.
        sql = re.sub(r"(?im)^\s*(?:BEGIN|COMMIT);\s*$", "", sql)
        if name == "20261005133000_catalogo_marketplace_test_allowlist.sql":
            # Não copiar a liberação nominal de um comércio de demonstração.
            sql, count = re.subn(
                r"(?ms)^INSERT INTO public\.catalogo_marketplace_testes \(comercio_id, ativo, motivo\).*?^ON CONFLICT[^\n]*;",
                "-- Carga nominal de demonstração omitida somente no staging.", sql,
            )
            if count != 1:
                raise ValueError("Carga de demonstração mudou; revise o bootstrap antes de aplicar.")
        parts.extend([f"\n-- Fonte original: {name}\n", sql])
        if index == 0:
            parts.append(RECEIVER)
    parts.append("""
UPDATE public.catalogo_automacao_config
SET fechamento_offline_ativo=false, fatura_pix_ativo=false WHERE id=true;
""")
    return {"project_id": project, "name": "catalogo_staging_base_para_entregas_v2", "query": "\n".join(parts)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--project", default=STAGING_PROJECT)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = generate(args.root, args.project)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Payload staging gerado: {args.output.resolve()} ({len(payload['query'])} caracteres SQL)")
