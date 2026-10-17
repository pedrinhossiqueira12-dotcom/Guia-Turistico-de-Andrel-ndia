-- COB-06, 17/10/2026: COMPATIBILIDADE EXCLUSIVA DO STAGING.
-- Executar SOMENTE no projeto Supabase "testes" jbttwihctuibchhcyqtl.
-- Abre apenas colunas historicas usadas pelas RPCs de encerramento.
-- NAO instalar em PROD; tabela de producao ja tem essas colunas.
-- O guard verifica a estrutura exclusiva do clone QA e a loja ficticia.
BEGIN;
DO $qa$
BEGIN
  IF to_regclass('public.comercios_publicados') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='comercios_publicados'
         AND column_name='solicitante_id'
    )
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='comercios_publicados'
         AND column_name='dados'
    )
    OR EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='comercios_publicados'
         AND column_name='criado_em'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.comercios_publicados WHERE local_id='asaas-cob02'
    )
  THEN
    RAISE EXCEPTION 'COB06: schema nao corresponde ao clone STAGING autorizado';
  END IF;
END
$qa$;
ALTER TABLE public.comercios_publicados
  ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deletado_em timestamptz,
  ADD COLUMN IF NOT EXISTS atualizado_por uuid;
COMMIT;
