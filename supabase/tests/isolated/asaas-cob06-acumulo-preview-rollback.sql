-- COB-06: exercicio PostgreSQL real apenas no catalogo_cob06_ci DESCARTAVEL.
-- Este ensaio valida ESTRUTURA/PREVIEW e deve terminar com ROLLBACK.
-- Nao reserva nem confirma pagamento, nao abre rede, nao cria Pix.
BEGIN;
DO $cob06_acumulo$
DECLARE
 v100 uuid;
 v400 uuid;
 v_result jsonb;
 v_fail integer:=0;
 v_lote1 uuid;
 v_lote2 uuid;
BEGIN
 IF pg_catalog.current_database()<>'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port()<>5432
    OR pg_catalog.to_regclass('public.catalogo_asaas_acumulo_lotes') IS NULL
    OR pg_catalog.to_regclass('public.catalogo_asaas_acumulo_fontes') IS NULL
 THEN RAISE EXCEPTION 'COB06_ACUMULO: somente catalogo_cob06_ci'; END IF;
 IF pg_catalog.has_table_privilege('anon','public.catalogo_asaas_acumulo_lotes','SELECT')
    OR pg_catalog.has_table_privilege('authenticated','public.catalogo_asaas_acumulo_fontes','SELECT')
    OR pg_catalog.has_table_privilege('service_role','public.catalogo_asaas_acumulo_lotes','INSERT')
    OR pg_catalog.has_table_privilege('service_role','public.catalogo_asaas_acumulo_fontes','INSERT')
    OR NOT pg_catalog.has_function_privilege('service_role',
      'public.catalogo_asaas_previsualizar_acumulo(text,date)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
      'public.catalogo_asaas_previsualizar_acumulo(text,date)','EXECUTE')
 THEN RAISE EXCEPTION 'COB06_ACUMULO: RLS ou privilegios inesperados'; END IF;

 -- Historico MP pago de 2024-01 deve continuar intocado.
 IF NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_cobrancas
  WHERE order_id='legacy-cob06-ci' AND gateway='mercadopago'
    AND status='pago' AND valor_centavos=700)
 THEN RAISE EXCEPTION 'COB06_ACUMULO: historico MP ausente'; END IF;

 INSERT INTO public.catalogo_fechamentos_offline
 (comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES ('comercio-de-exemplo','2024-03-01',1,100,'faturado')
 RETURNING id INTO v100;
 INSERT INTO public.catalogo_fechamentos_offline
 (comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES ('comercio-de-exemplo','2024-04-01',1,400,'faturado')
 RETURNING id INTO v400;

 v_result:=public.catalogo_asaas_previsualizar_acumulo(
    'comercio-de-exemplo','2024-03-01');
 IF (v_result->>'total_centavos')::bigint<>100
    OR v_result->>'pronto_para_preparar'<>'false'
 THEN RAISE EXCEPTION 'COB06_ACUMULO: preco 100 inesperado: %',v_result; END IF;

 v_result:=public.catalogo_asaas_previsualizar_acumulo(
    'comercio-de-exemplo','2024-04-01');
 IF (v_result->>'total_centavos')::bigint<>500
    OR (v_result->>'quantidade_faturas')::int<>2
    OR (v_result->>'quantidade_abaixo_minimo')::int<>2
    OR (v_result->>'snapshots_inconsistentes')::int<>2
    OR v_result->>'pronto_para_preparar'<>'false'
    OR v_result->>'reserva_criada'<>'false'
    OR v_result->>'pix_emitido'<>'false'
 THEN RAISE EXCEPTION 'COB06_ACUMULO: preview nao bloqueou snapshots incompletos: %',v_result; END IF;

 -- Estrutura admite referencia unica: source em mais de um lote recusa.
 INSERT INTO public.catalogo_asaas_acumulo_lotes
 (comercio_id,competencia_corte,total_centavos)
 VALUES('comercio-de-exemplo','2024-04-01',500) RETURNING id INTO v_lote1;
 INSERT INTO public.catalogo_asaas_acumulo_lotes
 (comercio_id,competencia_corte,total_centavos)
 VALUES('comercio-de-exemplo','2024-05-01',500) RETURNING id INTO v_lote2;
 INSERT INTO public.catalogo_asaas_acumulo_fontes
 (fechamento_id,lote_id,competencia,valor_centavos)
 VALUES(v100,v_lote1,'2024-03-01',100);
 BEGIN
  INSERT INTO public.catalogo_asaas_acumulo_fontes
  (fechamento_id,lote_id,competencia,valor_centavos)
  VALUES(v100,v_lote2,'2024-03-01',100);
  RAISE EXCEPTION 'COB06_ACUMULO: fonte duplicada aceita';
 EXCEPTION WHEN unique_violation THEN
  v_fail:=v_fail+1;
 END;

 BEGIN
  INSERT INTO public.catalogo_asaas_acumulo_lotes
  (comercio_id,competencia_corte,total_centavos)
  VALUES('comercio-de-exemplo','2024-04-01',500);
  RAISE EXCEPTION 'COB06_ACUMULO: segundo grupo da mesma competencia permitido';
 EXCEPTION WHEN unique_violation THEN
  v_fail:=v_fail+1;
 END;
 IF v_fail<>2
   OR (SELECT COUNT(*) FROM public.catalogo_fatura_cobrancas
       WHERE order_id='legacy-cob06-ci')<>1
   OR (SELECT status FROM public.catalogo_fechamentos_offline
       WHERE id=v100)<>'faturado'
   OR (SELECT status FROM public.catalogo_fechamentos_offline
       WHERE id=v400)<>'faturado'
 THEN RAISE EXCEPTION 'COB06_ACUMULO: historico alterado ou guardas nao acionadas'; END IF;
 RAISE NOTICE 'COB06_ACUMULO_LEDGER_PREVIEW_OK_SEM_PIX';
END;
$cob06_acumulo$;
ROLLBACK;
