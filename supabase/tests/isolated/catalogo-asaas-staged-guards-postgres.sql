-- Executar somente em PostgreSQL DESCARTAVEL, apos TODAS as migrations pendentes.
-- -X -v ON_ERROR_STOP=1 -f; nenhuma API de pagamentos e chamada.
-- A transacao sera revertida ate quando o teste for aprovado.
BEGIN;

DO $checks$
DECLARE
  v_id text := 'ci-asaas-encerramento-guard';
  v_uid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_residual uuid;
  v_rejected integer := 0;
  v_status text;
  v_rows integer;
  v_historico_ativo jsonb;
  v_historico_inativo jsonb;
  v_pendencias_ativas jsonb;
  v_pendencias_inativas jsonb;
BEGIN
  IF to_regprocedure('public.catalogo_status_publicacao(text[])') IS NULL
    OR to_regprocedure('public.catalogo_asaas_saldo_sacavel(uuid)') IS NULL
    OR NOT has_function_privilege('anon',
        'public.catalogo_status_publicacao(text[])','EXECUTE')
    OR has_table_privilege('anon','public.comercios_publicados','SELECT')
    OR has_table_privilege('authenticated',
        'public.catalogo_asaas_saldos_residuais','UPDATE')
  THEN
    RAISE EXCEPTION
      'Permissoes: rpc=% carteira=% anon_rpc=% anon_select=% motoboy_update=%',
      to_regprocedure('public.catalogo_status_publicacao(text[])') IS NOT NULL,
      to_regprocedure('public.catalogo_asaas_saldo_sacavel(uuid)') IS NOT NULL,
      has_function_privilege('anon',
        'public.catalogo_status_publicacao(text[])','EXECUTE'),
      has_table_privilege('anon','public.comercios_publicados','SELECT'),
      has_table_privilege('authenticated',
        'public.catalogo_asaas_saldos_residuais','UPDATE');
  END IF;

  INSERT INTO auth.users(id) VALUES(v_uid);
  INSERT INTO public.comercios_publicados(local_id,status)
    VALUES(v_id,'ativo');
  INSERT INTO public.catalogos(comercio_id,proprietario_id)
    VALUES(v_id,v_uid);

  -- Simula um entregador vinculado ao catálogo e depois inativado.
  -- Histórico financeiro não pode desaparecer só por desligamento.
  INSERT INTO public.catalogo_motoboys
    (comercio_id,usuario_id,nome,email,ativo,autorizado_por)
  VALUES(v_id,v_uid,'Motoboy CI','motoboy-ci@example.invalid',true,v_uid);
  IF to_regprocedure('public.catalogo_asaas_saldo_historico(uuid)') IS NULL
    OR to_regprocedure('public.catalogo_asaas_pendencias_historicas(uuid)') IS NULL
    OR has_function_privilege('anon',
        'public.catalogo_asaas_saldo_historico(uuid)','EXECUTE')
    OR has_function_privilege('authenticated',
        'public.catalogo_asaas_pendencias_historicas(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role',
        'public.catalogo_asaas_saldo_historico(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'RPC historicas inexistentes ou com privilegio indevido';
  END IF;

  SELECT public.catalogo_asaas_saldo_historico(v_uid)
    INTO v_historico_ativo;
  SELECT public.catalogo_asaas_pendencias_historicas(v_uid)
    INTO v_pendencias_ativas;
  UPDATE public.catalogo_motoboys SET ativo=false
    WHERE comercio_id=v_id AND usuario_id=v_uid;
  SELECT public.catalogo_asaas_saldo_historico(v_uid)
    INTO v_historico_inativo;
  SELECT public.catalogo_asaas_pendencias_historicas(v_uid)
    INTO v_pendencias_inativas;
  IF v_historico_ativo IS DISTINCT FROM v_historico_inativo
    OR v_pendencias_ativas IS DISTINCT FROM v_pendencias_inativas
    OR (public.catalogo_asaas_saldo_sacavel(v_uid)->>'disponivel_centavos')::bigint <> 0
  THEN RAISE EXCEPTION 'Inativacao alterou carteira historica ou liberou saque';
  END IF;

  INSERT INTO public.catalogo_encerramentos_comercio
    (comercio_id,solicitado_por,situacao)
    VALUES(v_id,v_uid,'pendente_arquivamento');
  UPDATE public.comercios_publicados SET status='deletado', deletado_em=now() WHERE local_id=v_id;

  -- UPDATE e UPSERT jamais reabrem empresa com encerramento pendente.
  BEGIN
    UPDATE public.comercios_publicados SET status='ativo' WHERE local_id=v_id;
    RAISE EXCEPTION 'Falha: UPDATE reabriu comercio';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;
  BEGIN
    INSERT INTO public.comercios_publicados(local_id,status) VALUES(v_id,'ativo')
      ON CONFLICT(local_id) DO UPDATE SET status=excluded.status;
    RAISE EXCEPTION 'Falha: UPSERT reabriu comercio';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;

  -- Fatura ficticia protege UPDATE e DELETE mesmo se o status era 'deletado'.
  INSERT INTO public.catalogo_fechamentos_offline
    (comercio_id,competencia,total_comissao_centavos,status)
    VALUES(v_id,date '2099-01-01',100,'aberto');
  BEGIN
    UPDATE public.comercios_publicados SET status='arquivado' WHERE local_id=v_id;
    RAISE EXCEPTION 'Falha: loja foi arquivada com debito';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;
  BEGIN
    DELETE FROM public.comercios_publicados WHERE local_id=v_id;
    RAISE EXCEPTION 'Falha: loja foi apagada com debito';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;
  SELECT status INTO v_status FROM public.comercios_publicados WHERE local_id=v_id;
  IF v_status IS DISTINCT FROM 'deletado' THEN
    RAISE EXCEPTION 'Status foi alterado apesar de bloqueio: %', v_status;
  END IF;

  -- O arquivo JSON pode continuar ativo, mas o tombstone tem precedencia.
  UPDATE public.catalogo_encerramentos_comercio
  SET situacao='arquivado' WHERE comercio_id=v_id;
  SELECT status INTO v_status
    FROM public.catalogo_status_publicacao(ARRAY[v_id]);
  IF v_status IS DISTINCT FROM 'arquivado' THEN
    RAISE EXCEPTION 'RPC publica ignorou arquivamento: %',v_status;
  END IF;
  SELECT count(*) INTO v_rows
    FROM public.catalogo_status_publicacao(ARRAY['ci-inexistente']);
  IF v_rows<>0 THEN
    RAISE EXCEPTION 'RPC publica retornou loja inexistente';
  END IF;

  -- Pedidos residuais: registrar analise nao paga, nao permite quitacao
  -- artificial nem edicao de valor original.
  INSERT INTO public.catalogo_asaas_saldos_residuais
    (motoboy_id,saldo_snapshot_centavos,motivo)
    VALUES(v_uid,250,'inatividade') RETURNING id INTO v_residual;

  -- A analise em andamento nao pode registrar analisado_por:
  -- esse campo e reservado por CHECK para a decisao final.
  UPDATE public.catalogo_asaas_saldos_residuais
    SET status='em_analise', analisado_por=NULL
    WHERE id=v_residual AND status='pendente';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falha: pendente nao entrou em analise';
  END IF;

  BEGIN
    UPDATE public.catalogo_asaas_saldos_residuais SET
      status='concluida',analisado_por=v_uid,finalizado_em=now(),
      detalhe_revisao='Sem comprovante'
    WHERE id=v_residual;
    RAISE EXCEPTION 'Falha: analise foi concluida sem prova financeira';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;
  BEGIN
    UPDATE public.catalogo_asaas_saldos_residuais
      SET saldo_snapshot_centavos=9999 WHERE id=v_residual;
    RAISE EXCEPTION 'Falha: valor original foi adulterado';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;
  BEGIN
    UPDATE public.catalogo_asaas_saldos_residuais
    SET status='recusada',analisado_por=v_uid,finalizado_em=now()
    WHERE id=v_residual;
    RAISE EXCEPTION 'Falha: recusa sem justificativa';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;

  UPDATE public.catalogo_asaas_saldos_residuais
    SET status='recusada',analisado_por=v_uid,finalizado_em=now(),
        detalhe_revisao='Recusa ficticia com justificativa'
    WHERE id=v_residual;
  BEGIN
    UPDATE public.catalogo_asaas_saldos_residuais
      SET detalhe_revisao='Alteracao indevida' WHERE id=v_residual;
    RAISE EXCEPTION 'Falha: alterou registro ja finalizado';
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := v_rejected + 1;
  END;

  IF v_rejected<>8 THEN
    RAISE EXCEPTION 'Esperadas oito recusas; recebidas %',v_rejected;
  END IF;
  RAISE NOTICE 'PASS: 8 recusas de encerramento/saque; RPC e RLS verificadas';
END
$checks$;

DO $regularizacao$
DECLARE v_uid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_id uuid; v_rejeicoes integer := 0; v_estado text;
BEGIN
 IF to_regclass('public.catalogo_asaas_regularizacoes_inativos') IS NULL
   OR has_table_privilege('anon','public.catalogo_asaas_regularizacoes_inativos','SELECT')
   OR has_table_privilege('authenticated','public.catalogo_asaas_regularizacoes_inativos','INSERT')
   OR NOT has_table_privilege('service_role','public.catalogo_asaas_regularizacoes_inativos','INSERT')
 THEN RAISE EXCEPTION 'Regularizacao ausente ou exposicao indevida'; END IF;

 INSERT INTO public.catalogo_asaas_regularizacoes_inativos
   (motoboy_id,saldo_snapshot_centavos,motivo)
 VALUES(v_uid,15000,'inatividade') RETURNING id INTO v_id;
 BEGIN
   INSERT INTO public.catalogo_asaas_regularizacoes_inativos
     (motoboy_id,saldo_snapshot_centavos,motivo)
   VALUES(v_uid,16000,'inatividade');
   RAISE EXCEPTION 'Regularizacao duplicada foi aceita';
 EXCEPTION WHEN unique_violation THEN v_rejeicoes:=v_rejeicoes+1;
 END;

 BEGIN
   UPDATE public.catalogo_asaas_regularizacoes_inativos
     SET saldo_snapshot_centavos=20000 WHERE id=v_id;
   RAISE EXCEPTION 'Snapshot alterado';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejeicoes:=v_rejeicoes+1;
 END;
 UPDATE public.catalogo_asaas_regularizacoes_inativos
   SET status='em_analise',atualizado_em=now() WHERE id=v_id;
 UPDATE public.catalogo_asaas_regularizacoes_inativos
   SET status='recusada',revisado_por=v_uid,finalizado_em=now(),
       atualizado_em=now(),
       justificativa='Recusa administrativa de teste com saldo preservado'
   WHERE id=v_id AND status='em_analise';
 BEGIN
   UPDATE public.catalogo_asaas_regularizacoes_inativos
     SET status='pendente' WHERE id=v_id;
   RAISE EXCEPTION 'Pedido finalizado reaberto';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejeicoes:=v_rejeicoes+1;
 END;
 SELECT status INTO v_estado FROM public.catalogo_asaas_regularizacoes_inativos WHERE id=v_id;
 IF v_rejeicoes<>3 OR v_estado IS DISTINCT FROM 'recusada'
 THEN RAISE EXCEPTION 'Regularizacao inconsistente: refusas %, estado %',v_rejeicoes,v_estado;
 END IF;
 RAISE NOTICE 'PASS: regularizacao somente administrativa, idempotencia e trilha imutavel';
END
$regularizacao$;

ROLLBACK;
