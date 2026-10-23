-- COB-06: teste EXCLUSIVAMENTE EM CLONE PG LOCAL DESCARTAVEL.
-- Depende de baseline catalogo_ci e das 9 etapas seletivas de cobrança.
-- Nunca executar com PGHOST diferente de localhost/catalogo_cob06_ci.
-- Todos os dados deste ensaio serão revertidos ao final.
BEGIN;

DO $cob06$
DECLARE
  v_owner uuid := '00000000-0000-4000-8000-000000000099'::uuid;
  v_result jsonb;
  v_status text;
  v_fails integer := 0;
BEGIN
  IF pg_catalog.current_database() <> 'catalogo_cob06_ci'
     OR pg_catalog.inet_server_port() <> 5432 THEN
    RAISE EXCEPTION 'COB06: banco descartavel/local exigido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogos
    WHERE comercio_id = 'comercio-de-exemplo' AND proprietario_id = v_owner
  ) OR NOT EXISTS (
    SELECT 1 FROM public.comercios_publicados
    WHERE local_id = 'comercio-de-exemplo' AND status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'COB06: fixture de comercio do baseline nao localizada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_fatura_cobrancas
    WHERE order_id = 'legacy-cob06-ci' AND gateway = 'mercadopago'
      AND status = 'pago' AND valor_centavos = 700
  ) THEN
    RAISE EXCEPTION 'COB06: cobranca MP historica nao encontrada';
  END IF;

  INSERT INTO public.catalogo_fechamentos_offline
    (comercio_id, competencia, total_pedidos, total_comissao_centavos, status)
  VALUES ('comercio-de-exemplo','2024-02-01',1,500,'faturado');

  -- A Edge legada tenta atualizar o status diretamente para deletado.
  BEGIN
    UPDATE public.comercios_publicados
    SET status = 'deletado', deletado_em = pg_catalog.now()
    WHERE local_id='comercio-de-exemplo' AND status='ativo';
    RAISE EXCEPTION 'COB06_FAIL: exclusao legada permitiu despublicacao com divida';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_fails := v_fails + 1;
  END;

  -- Mesmo usuario privilegiado nao deve poder apagar o registro de publicacao.
  BEGIN
    DELETE FROM public.comercios_publicados
    WHERE local_id='comercio-de-exemplo';
    RAISE EXCEPTION 'COB06_FAIL: exclusao fisica da publicacao permitida com divida';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_fails := v_fails + 1;
  END;

  -- Historico financeiro protege a tabela principal mesmo que quite a fatura.
  BEGIN
    DELETE FROM public.catalogos
    WHERE comercio_id='comercio-de-exemplo';
    RAISE EXCEPTION 'COB06_FAIL: exclusao fisica de catalogo com historico permitida';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_fails := v_fails + 1;
  END;

  -- Solicitar encerramento bloqueia novas vendas e preserva divida.
  SELECT public.catalogo_solicitar_encerramento_financeiro(
    'comercio-de-exemplo', v_owner
  ) INTO v_result;
  IF v_result->>'ok'<>'true'
    OR v_result->>'situacao'<>'aguardando_quitacao'
    OR (v_result->>'divida_centavos')::integer < 500
    OR NOT EXISTS(SELECT 1 FROM public.catalogos
       WHERE comercio_id='comercio-de-exemplo' AND bloqueado = true)
  THEN RAISE EXCEPTION 'COB06: encerramento com debito falhou: %',v_result; END IF;

  -- Mesmo com administrador ficticio autorizado, divida impede finalizar.
  SELECT public.catalogo_finalizar_encerramento_financeiro(
    'comercio-de-exemplo','4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
  ) INTO v_result;
  IF v_result->>'ok'<>'false' THEN
    RAISE EXCEPTION 'COB06: finalizacao com divida foi aceita: %',v_result;
  END IF;

  -- Caminho do UPSERT legado tambem deve ser recusado apos solicitar encerramento.
  BEGIN
    INSERT INTO public.comercios_publicados(local_id,status,destaque)
    VALUES ('comercio-de-exemplo','ativo',false)
    ON CONFLICT(local_id) DO UPDATE SET status='ativo';
    RAISE EXCEPTION 'COB06_FAIL: republicacao por UPSERT permitida com encerramento';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_fails := v_fails + 1;
  END;

  -- Outra automacao antiga nao pode reabrir o catalogo.
  BEGIN
    UPDATE public.catalogos SET bloqueado=false
    WHERE comercio_id='comercio-de-exemplo';
    RAISE EXCEPTION 'COB06_FAIL: reabertura automatica permitida';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_fails := v_fails + 1;
  END;

  SELECT status INTO v_status FROM public.comercios_publicados
    WHERE local_id='comercio-de-exemplo';
  IF v_status IS DISTINCT FROM 'ativo'
      OR v_fails <> 5
      OR (SELECT status FROM public.catalogo_fatura_cobrancas
          WHERE order_id='legacy-cob06-ci') <> 'pago' THEN
    RAISE EXCEPTION 'COB06: nao preservou historico/recusas (status %, negativas %)',v_status,v_fails;
  END IF;
  RAISE NOTICE 'COB06 PASSOU: cinco bloqueios de rotas legadas, divida preservada e MP pago intacto';
END $cob06$;
-- Sem catalogo: exige admin, publicacao existente e zero historico.
DO $sem_catalogo$
DECLARE r jsonb;
BEGIN
 IF current_database()<>'catalogo_cob06_ci'
 THEN RAISE EXCEPTION 'COB06: banco CI incorreto'; END IF;
 IF EXISTS(SELECT 1 FROM public.comercios_publicados
   WHERE local_id='cob06-sem-catalogo-ci') THEN
   RAISE EXCEPTION 'COB06: fixture ja existe'; END IF;
 -- O baseline CI cria Auth minima sem admin; simular identidade de admin
 -- apenas dentro deste ROLLBACK para satisfazer FK atualizado_por.
 INSERT INTO auth.users(id)
 VALUES('4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.comercios_publicados(local_id,status,destaque)
 VALUES('cob06-sem-catalogo-ci','ativo',false);
 r:=public.catalogo_arquivar_sem_catalogo_admin(
  'cob06-sem-catalogo-ci','00000000-0000-4000-8000-000000000099'::uuid);
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'COB06: usuario comum arquivou loja'; END IF;
 r:=public.catalogo_arquivar_sem_catalogo_admin(
  'comercio-de-exemplo','4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'COB06: catalogo financeiro contornado'; END IF;
 r:=public.catalogo_arquivar_sem_catalogo_admin(
  'cob06-sem-catalogo-ci','4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF r->>'ok'<>'true'
    OR (SELECT status FROM public.comercios_publicados
       WHERE local_id='cob06-sem-catalogo-ci') <> 'deletado'
 THEN RAISE EXCEPTION 'COB06: admin sem catalogo nao arquivou'; END IF;
 r:=public.catalogo_arquivar_sem_catalogo_admin(
  'cob06-sem-catalogo-ci','4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF r->>'ja_arquivado'<>'true' THEN RAISE EXCEPTION 'COB06: idempotencia falhou'; END IF;
 IF has_function_privilege('anon','public.catalogo_arquivar_sem_catalogo_admin(text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.catalogo_arquivar_sem_catalogo_admin(text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'COB06: RPC exposta a usuarios publicos'; END IF;
 RAISE NOTICE 'COB06_SEM_CATALOGO_CI_OK';
END;
$sem_catalogo$;
SELECT 'COB06: PROTECOES LEGADAS APROVADAS; fixture sera revertida' AS resultado;
ROLLBACK;
