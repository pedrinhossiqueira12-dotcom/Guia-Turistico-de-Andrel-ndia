-- COB-06: SOMENTE execucao dentro da transacao do ensaio offline de nove SQL.
-- NAO executar diretamente, NAO usar no Supabase PROD/STAGING e NAO publicar.
-- Dados sinteticos locais sao revertidos pelo ROLLBACK externo.
DO $cob06_guardas_reais$
DECLARE
 v_loja constant text := 'cob06-fixture-descartavel-20261015';
 v_dono uuid;
 v_res jsonb;
 v_status text;
 v_situacao text;
 v_status_rpc text;
 v_negativas integer := 0;
 v_mp_antes bigint;
BEGIN
 -- Defesa secundaria: o controle principal de container/volume/rede e no PowerShell.
 IF pg_catalog.current_database() <> 'postgres'
    OR pg_catalog.inet_client_addr() IS NOT NULL
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 29
    OR to_regclass('public.catalogo_asaas_emissoes') IS NULL
 THEN RAISE EXCEPTION 'COB06_GUARDAS: ambiente offline esperado nao confirmado'; END IF;

 SELECT id INTO v_dono FROM auth.users ORDER BY id LIMIT 1;
 IF v_dono IS NULL THEN
   RAISE EXCEPTION 'COB06_GUARDAS: fixture exige um usuario Auth do clone (nao alterado)';
 END IF;
 IF EXISTS (SELECT 1 FROM public.comercios_publicados WHERE local_id=v_loja)
    OR EXISTS (SELECT 1 FROM public.catalogos WHERE comercio_id=v_loja)
    OR EXISTS (SELECT 1 FROM public.catalogo_fechamentos_offline WHERE comercio_id=v_loja)
 THEN RAISE EXCEPTION 'COB06_GUARDAS: identificador sintetico ja existe'; END IF;

 SELECT count(*) INTO v_mp_antes
 FROM public.catalogo_fatura_cobrancas
 WHERE gateway='mercadopago' AND status='pago';

 -- Fixture inteiramente sintetica: nao criar pedido Pix, saldo, saque ou webhook.
 INSERT INTO public.comercios_publicados(local_id,status,destaque)
 VALUES (v_loja,'ativo',false);
 INSERT INTO public.catalogos(comercio_id,proprietario_id)
 VALUES (v_loja,v_dono);
 INSERT INTO public.catalogo_fechamentos_offline(
    comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES (v_loja,'2040-01-01',1,500,'faturado');

 IF (SELECT count(*) FROM public.catalogo_fechamentos_offline
     WHERE comercio_id=v_loja AND status='faturado') <> 1 THEN
   RAISE EXCEPTION 'COB06_GUARDAS: divida de teste nao criada'; END IF;

 -- 1. UPDATE da antiga Edge: deve ser recusado por pendencias financeiras.
 BEGIN
   UPDATE public.comercios_publicados
   SET status='deletado',deletado_em=now()
   WHERE local_id=v_loja;
   RAISE EXCEPTION 'COB06_FAIL: UPDATE legado excluiu loja devedora';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   v_negativas := v_negativas + 1;
 END;

 -- 2. DELETE fisico da publicacao: nao pode ocultar a divida.
 BEGIN
   DELETE FROM public.comercios_publicados WHERE local_id=v_loja;
   RAISE EXCEPTION 'COB06_FAIL: DELETE da publicacao devedora permitido';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   v_negativas := v_negativas + 1;
 END;

 -- 3. DELETE do catalogo com historico financeiro: proibido.
 BEGIN
   DELETE FROM public.catalogos WHERE comercio_id=v_loja;
   RAISE EXCEPTION 'COB06_FAIL: catalogo com historico excluido fisicamente';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   v_negativas := v_negativas + 1;
 END;

 -- 4. Titular errado nao solicita encerramento.
 v_res := public.catalogo_solicitar_encerramento_financeiro(
   v_loja, '00000000-0000-4000-8000-000000000099'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'false'
    OR EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio
              WHERE comercio_id=v_loja)
 THEN RAISE EXCEPTION 'COB06_FAIL: titular errado solicitou encerramento'; END IF;

 -- 5. Titular correto suspende novos pedidos, mas divida permanece.
 v_res := public.catalogo_solicitar_encerramento_financeiro(v_loja,v_dono);
 IF (v_res->>'ok') IS DISTINCT FROM 'true'
    OR (v_res->>'situacao') IS DISTINCT FROM 'aguardando_quitacao'
    OR (v_res->>'divida_centavos')::bigint <> 500
    OR NOT EXISTS(SELECT 1 FROM public.catalogos WHERE comercio_id=v_loja
                  AND bloqueado=true)
 THEN RAISE EXCEPTION 'COB06_FAIL: solicitacao de encerramento devedor incorreta'; END IF;

 -- 6. Nem administrador pode finalizar enquanto a divida existe.
 v_res := public.catalogo_finalizar_encerramento_financeiro(
   v_loja,'4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'COB06_FAIL: loja devedora arquivada pelo administrador'; END IF;

 -- 7. UPSERT da Edge antiga nao pode republicar loja em encerramento.
 BEGIN
   INSERT INTO public.comercios_publicados(local_id,status,destaque)
   VALUES (v_loja,'ativo',false)
   ON CONFLICT(local_id) DO UPDATE SET status='ativo';
   RAISE EXCEPTION 'COB06_FAIL: republicacao apos encerramento permitida';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   v_negativas := v_negativas + 1;
 END;

 -- 8. Reabertura de catalogo em encerramento deve falhar.
 BEGIN
   UPDATE public.catalogos SET bloqueado=false WHERE comercio_id=v_loja;
   RAISE EXCEPTION 'COB06_FAIL: reabertura do catalogo encerrando permitida';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   v_negativas := v_negativas + 1;
 END;

 IF v_negativas<>5
    OR (SELECT status FROM public.comercios_publicados WHERE local_id=v_loja)<>'ativo'
 THEN RAISE EXCEPTION 'COB06_FAIL: cinco guardas financeiras nao foram comprovadas'; END IF;

 -- Somente para simular quitação em copia ISOLADA e na transacao sem COMMIT.
 -- Nao ha POST bancario nem alteracao de fatura/usuario real.
 UPDATE public.catalogo_fechamentos_offline
 SET status='pago',pago_em=now()
 WHERE comercio_id=v_loja AND competencia='2040-01-01' AND status='faturado';
 IF NOT FOUND THEN RAISE EXCEPTION 'COB06_FAIL: quitação sintetica nao aplicada'; END IF;

 v_res := public.catalogo_finalizar_encerramento_financeiro(
   v_loja,'4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'true'
    OR (v_res->>'situacao') IS DISTINCT FROM 'arquivado'
 THEN RAISE EXCEPTION 'COB06_FAIL: nao finalizou apos quitação sintetica'; END IF;

 SELECT status INTO v_status FROM public.comercios_publicados
 WHERE local_id=v_loja;
 SELECT situacao INTO v_situacao FROM public.catalogo_encerramentos_comercio
 WHERE comercio_id=v_loja;
 SELECT status INTO v_status_rpc
 FROM public.catalogo_status_publicacao(ARRAY[v_loja]);
 IF v_status IS DISTINCT FROM 'deletado'
    OR v_situacao IS DISTINCT FROM 'arquivado'
    OR v_status_rpc IS DISTINCT FROM 'arquivado'
 THEN RAISE EXCEPTION 'COB06_FAIL: inconsistencia publicacao/tombstone/RPC'; END IF;

 IF (SELECT count(*) FROM public.catalogo_fatura_cobrancas
     WHERE gateway='mercadopago' AND status='pago') <> v_mp_antes
 THEN RAISE EXCEPTION 'COB06_FAIL: historico Mercado Pago alterado'; END IF;

 -- Sem catalogo: o administrador pode arquivar somente com comprovacao
 -- de ausencia de catalogo, dividas, pedidos e qualquer historico financeiro.
 IF EXISTS (SELECT 1 FROM public.comercios_publicados
            WHERE local_id='cob06-sem-catalogo-fixture-20261015')
 THEN RAISE EXCEPTION 'COB06_FAIL: fixture sem catalogo ja existe'; END IF;
 INSERT INTO public.comercios_publicados(local_id,status,destaque)
 VALUES ('cob06-sem-catalogo-fixture-20261015','ativo',false);
 v_res := public.catalogo_arquivar_sem_catalogo_admin(
   'cob06-sem-catalogo-fixture-20261015',v_dono);
 IF (v_res->>'ok') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'COB06_FAIL: nao admin arquivou sem catalogo'; END IF;
 v_res := public.catalogo_arquivar_sem_catalogo_admin(
   'comercio-inexistente-cob06','4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'COB06_FAIL: publicacao inexistente foi arquivada'; END IF;
 v_res := public.catalogo_arquivar_sem_catalogo_admin(
   v_loja,'4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'COB06_FAIL: admin contornou catalogo existente'; END IF;
 v_res := public.catalogo_arquivar_sem_catalogo_admin(
   'cob06-sem-catalogo-fixture-20261015',
   '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'true'
 OR (v_res->>'sem_catalogo') IS DISTINCT FROM 'true'
 OR (SELECT status FROM public.comercios_publicados
     WHERE local_id='cob06-sem-catalogo-fixture-20261015') IS DISTINCT FROM 'deletado'
 THEN RAISE EXCEPTION 'COB06_FAIL: arquivamento seguro sem catalogo falhou: %',v_res; END IF;
 v_res := public.catalogo_arquivar_sem_catalogo_admin(
   'cob06-sem-catalogo-fixture-20261015',
   '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);
 IF (v_res->>'ok') IS DISTINCT FROM 'true'
 OR (v_res->>'ja_arquivado') IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'COB06_FAIL: idempotencia sem catalogo falhou'; END IF;
 RAISE NOTICE 'COB06_SEM_CATALOGO_ADMIN_OK: admin restrito, sem divida/historico, idempotente';

 RAISE NOTICE 'COB06_GUARDAS_FUNCIONAIS_OK: cinco recusas, divida, quitacao sintetica, arquivo e RPC';
END $cob06_guardas_reais$;
