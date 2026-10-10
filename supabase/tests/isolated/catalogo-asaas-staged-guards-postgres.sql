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

DO $overlap$
DECLARE
 v_uid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_res uuid;
 v_saida uuid;
 v_rejected integer := 0;
BEGIN
 IF to_regprocedure('catalogo_private.catalogo_impedir_revisoes_sobrepostas()') IS NULL THEN
  RAISE EXCEPTION 'Trigger de solicitacoes simultaneas ausente';
 END IF;

 INSERT INTO public.catalogo_asaas_saldos_residuais
  (motoboy_id,saldo_snapshot_centavos,motivo)
 VALUES(v_uid,900,'inatividade') RETURNING id INTO v_res;

 BEGIN
  INSERT INTO public.catalogo_asaas_regularizacoes_inativos
   (motoboy_id,saldo_snapshot_centavos,motivo)
  VALUES(v_uid,12500,'inatividade');
  RAISE EXCEPTION 'Revisao de saida simultanea foi aceita';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=v_rejected+1;
 END;

 UPDATE public.catalogo_asaas_saldos_residuais
 SET status='recusada',detalhe_revisao='Analise residual encerrada no ensaio financeiro',
  analisado_por=v_uid,finalizado_em=now(),atualizado_em=now()
 WHERE id=v_res;
 INSERT INTO public.catalogo_asaas_regularizacoes_inativos
  (motoboy_id,saldo_snapshot_centavos,motivo)
 VALUES(v_uid,12500,'inatividade') RETURNING id INTO v_saida;

 BEGIN
  INSERT INTO public.catalogo_asaas_saldos_residuais
   (motoboy_id,saldo_snapshot_centavos,motivo)
  VALUES(v_uid,700,'inatividade');
  RAISE EXCEPTION 'Analise residual simultanea foi aceita';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected:=v_rejected+1;
 END;

 IF v_rejected<>2 THEN
  RAISE EXCEPTION 'Recusas de solicitacoes simultaneas ausentes: %',v_rejected;
 END IF;
 RAISE NOTICE 'PASS: dois caminhos de solicitacao nao podem coexistir em aberto';
END $overlap$;

DO $preflight_check$
DECLARE
 v_user uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_request uuid;
 v_response jsonb;
BEGIN
 SELECT id INTO v_request
 FROM public.catalogo_asaas_regularizacoes_inativos
 WHERE motoboy_id=v_user AND status='pendente'
 ORDER BY solicitado_em DESC LIMIT 1;
 IF v_request IS NULL THEN RAISE EXCEPTION 'Solicitacao de CI para preconferencia nao encontrada'; END IF;
 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_request)
 INTO v_response;
 IF v_response->>'ok' IS DISTINCT FROM 'true'
    OR v_response->>'pagamento_autorizado' IS DISTINCT FROM 'false'
    OR v_response->>'requer_revalidacao_transacional' IS DISTINCT FROM 'true'
    OR v_response->>'saldo_snapshot_centavos' IS DISTINCT FROM '12500'
 THEN RAISE EXCEPTION 'Resposta de preconferencia insegura: %',v_response;
 END IF;
 IF has_function_privilege('anon',
       'public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated',
       'public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role',
       'public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Preconferencia nao e privada do backend'; END IF;
 IF (public.catalogo_asaas_preconferir_pagamento_excepcional('outra',v_request)->>'ok') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Preconferencia aceitou tipo invalido'; END IF;
 RAISE NOTICE 'PASS: preconferencia somente leitura, bloqueada para publico e sem autorizar pagamentos';
END $preflight_check$;

DO $evidence$
DECLARE
 v_uid uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_request uuid;
 v_first jsonb;
 v_duplicate jsonb;
 v_done jsonb;
 v_mismatch jsonb;
 v_n integer;
BEGIN
 SELECT id INTO v_request
 FROM public.catalogo_asaas_regularizacoes_inativos
 WHERE motoboy_id=v_uid AND status='pendente' AND saldo_snapshot_centavos=12500
 LIMIT 1;
 IF v_request IS NULL THEN RAISE EXCEPTION 'Solicitacao de saida da CI inexistente'; END IF;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_request,'sandbox_tx_ci_01',
  'guia-exc:saida:'||v_request,12500,'PENDING') INTO v_first;
 IF v_first->>'ok'<>'true' OR v_first->>'observacao_nova'<>'true'
 THEN RAISE EXCEPTION 'Primeira observacao falhou: %',v_first; END IF;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_request,'sandbox_tx_ci_01',
  'guia-exc:saida:'||v_request,12500,'PENDING') INTO v_duplicate;
 IF v_duplicate->>'observacao_nova'<>'false' THEN
  RAISE EXCEPTION 'Repeticao de evento nao foi idempotente'; END IF;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_request,'sandbox_tx_ci_01',
  'guia-exc:saida:'||v_request,12500,'DONE') INTO v_done;
 IF v_done->>'ok'<>'true' OR v_done->>'pagamento_baixado'<>'false'
 OR v_done->>'requer_validacao_destinatario'<>'true' THEN
  RAISE EXCEPTION 'DONE confundido com baixa financeira: %',v_done; END IF;

 SELECT count(*) INTO v_n
 FROM public.catalogo_asaas_observacoes_excepcionais_auditoria o
 JOIN public.catalogo_asaas_transferencias_excepcionais_auditoria v ON v.id=o.vinculo_id
 WHERE v.solicitacao_id=v_request;
 IF v_n<>2 THEN RAISE EXCEPTION 'Duplicacao de observacoes de provedor: %',v_n; END IF;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_request,'sandbox_tx_ci_02',
  'guia-exc:saida:'||v_request,12500,'DONE') INTO v_mismatch;
 IF v_mismatch->>'ok'='true' THEN RAISE EXCEPTION 'Mesmo pedido aceitou outra transferencia'; END IF;
 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_request,'sandbox_tx_ci_01',
  'guia-exc:saida:'||v_request,12501,'DONE') INTO v_mismatch;
 IF v_mismatch->>'ok'='true' THEN RAISE EXCEPTION 'Valor divergente aceito'; END IF;

 IF has_function_privilege('anon',
    'public.catalogo_asaas_registrar_observacao_excepcional(text,uuid,text,text,bigint,text)','EXECUTE')
 OR has_function_privilege('authenticated',
    'public.catalogo_asaas_registrar_observacao_excepcional(text,uuid,text,text,bigint,text)','EXECUTE')
 OR has_table_privilege('anon',
    'public.catalogo_asaas_transferencias_excepcionais_auditoria','SELECT')
 OR has_table_privilege('authenticated',
    'public.catalogo_asaas_observacoes_excepcionais_auditoria','INSERT')
 THEN RAISE EXCEPTION 'Auditoria bancaria exposta ao publico'; END IF;

 RAISE NOTICE 'PASS: banco observado e idempotente, nunca baixa creditos ou autoriza Pix';
END $evidence$;

DO $saque_exclusivo$
DECLARE
 v_uid uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_res uuid;
 v_saque uuid;
 v_saida uuid;
 v_refused integer := 0;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);

 INSERT INTO public.catalogo_asaas_saldos_residuais(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_uid,799,'inatividade') RETURNING id INTO v_res;

 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
  VALUES(v_uid,10000);
  RAISE EXCEPTION 'Saque regular criado durante analise residual aberta';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_refused:=v_refused+1;
 END;

 UPDATE public.catalogo_asaas_saldos_residuais
 SET status='recusada',analisado_por=v_uid,finalizado_em=now(),
   detalhe_revisao='Recusa sintetica para testar exclusao mutua com saques'
 WHERE id=v_res;

 INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
 VALUES(v_uid,10000) RETURNING id INTO v_saque;

 BEGIN
  INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,11000,'inatividade');
  RAISE EXCEPTION 'Regularizacao criada durante saque regular reservado';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_refused:=v_refused+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_saldos_residuais(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,900,'inatividade');
  RAISE EXCEPTION 'Analise residual criada durante saque regular reservado';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_refused:=v_refused+1;
 END;

 UPDATE public.catalogo_asaas_saques SET status='falhou' WHERE id=v_saque;
 INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_uid,11000,'inatividade') RETURNING id INTO v_saida;

 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
  VALUES(v_uid,10000);
  RAISE EXCEPTION 'Saque regular criado durante regularizacao aberta';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_refused:=v_refused+1;
 END;

 IF v_refused<>4 THEN
  RAISE EXCEPTION 'Quatro bloqueios de exclusao mutua esperados; recebidos %',v_refused;
 END IF;
 RAISE NOTICE 'PASS: travas compartilhadas entre saque regular e pedidos excepcionais';
END $saque_exclusivo$;

DO $bank_evidence_hold$
DECLARE
 v_uid uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 v_other uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 v_req uuid;
 v_other_req uuid;
 v_normal uuid;
 v_evidence jsonb;
 v_preconferencia jsonb;
 v_rejections integer:=0;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid),(v_other);

 -- Um registro bancario observado retém o saldo mesmo se a análise foi recusada.
 INSERT INTO public.catalogo_asaas_saldos_residuais
   (motoboy_id,saldo_snapshot_centavos,motivo)
 VALUES(v_uid,600,'inatividade') RETURNING id INTO v_req;
 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'residual',v_req,'ci_hold_bank_01',
  'guia-exc:residual:'||v_req,600,'PENDING'
 ) INTO v_evidence;
 IF v_evidence->>'ok'<>'true' THEN RAISE EXCEPTION 'Evidencia do CI nao registrada'; END IF;

 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('residual',v_req)
 INTO v_preconferencia;
 IF v_preconferencia->>'evidencias_bancarias_para_conciliar' IS DISTINCT FROM '1'
 OR v_preconferencia->>'sem_impedimentos_identificados' IS DISTINCT FROM 'false'
 OR v_preconferencia->>'pagamento_autorizado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Preconferencia ignorou evidencia bancaria em HOLD: %',v_preconferencia;
 END IF;

 UPDATE public.catalogo_asaas_saldos_residuais
 SET status='recusada',analisado_por=v_uid,finalizado_em=now(),
     detalhe_revisao='A analise de teste foi recusada, mantendo o hold bancario'
 WHERE id=v_req;

 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
  VALUES(v_uid,10000);
  RAISE EXCEPTION 'Permitiu saque comum com evidencia excepcional';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejections:=v_rejections+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_saldos_residuais(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,500,'inatividade');
  RAISE EXCEPTION 'Permitiu outra analise residual com evidencia bancaria';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejections:=v_rejections+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,12000,'inatividade');
  RAISE EXCEPTION 'Permitiu outra regularizacao com evidencia bancaria';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejections:=v_rejections+1;
 END;

 -- Testa conflito tardio: observação chega depois de reserva normal.
 INSERT INTO public.catalogo_asaas_saldos_residuais(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_other,250,'inatividade') RETURNING id INTO v_other_req;
 UPDATE public.catalogo_asaas_saldos_residuais
 SET status='recusada',analisado_por=v_other,finalizado_em=now(),
     detalhe_revisao='Analise anterior de teste encerrada antes do saque comum'
 WHERE id=v_other_req;
 INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
 VALUES(v_other,10000) RETURNING id INTO v_normal;
 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'residual',v_other_req,'ci_hold_late_01',
  'guia-exc:residual:'||v_other_req,250,'DONE'
 ) INTO v_evidence;
 IF v_evidence->>'pagamento_baixado'<>'false' THEN
  RAISE EXCEPTION 'Observacao tardia liquidou saldo sem prova';
 END IF;

 BEGIN
  UPDATE public.catalogo_asaas_saques SET status='concluido' WHERE id=v_normal;
  RAISE EXCEPTION 'Permitiu conciliacao contábil normal com banco excepcional em revisão';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_rejections:=v_rejections+1;
 END;

 IF v_rejections<>4 THEN RAISE EXCEPTION 'Hold bancario falhou: %',v_rejections; END IF;
 RAISE NOTICE 'PASS: evidencia bancaria preserva HOLD apos recusas e na concorrencia com saque normal';
END $bank_evidence_hold$;

DO $authorization_revalidation$
DECLARE
 v_uid uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 v_req uuid;
 v_saque uuid;
 v_first jsonb;
 v_after jsonb;
 v_event jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);
 INSERT INTO public.catalogo_asaas_saldos_residuais
   (motoboy_id,saldo_snapshot_centavos,motivo)
 VALUES(v_uid,330,'inatividade') RETURNING id INTO v_req;
 UPDATE public.catalogo_asaas_saldos_residuais
 SET status='recusada',analisado_por=v_uid,finalizado_em=now(),
     detalhe_revisao='Revisao sintética encerrada antes de reservar saque comum'
 WHERE id=v_req;

 INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
 VALUES(v_uid,10000) RETURNING id INTO v_saque;
 SELECT public.catalogo_asaas_validar_reserva_saque(v_saque)
 INTO v_first;
 IF v_first->>'ok' IS DISTINCT FROM 'true'
    OR v_first->>'bloqueio_excepcional' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Reserva de teste previamente em HOLD: %',v_first;
 END IF;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'residual',v_req,'sandbox_late_auth_01',
  'guia-exc:residual:'||v_req,330,'DONE') INTO v_event;
 IF v_event->>'ok'<>'true' THEN RAISE EXCEPTION 'Evidencia bancaria de teste rejeitada'; END IF;

 SELECT public.catalogo_asaas_validar_reserva_saque(v_saque)
 INTO v_after;
 IF v_after->>'ok' IS DISTINCT FROM 'true'
    OR v_after->>'bloqueio_excepcional' IS DISTINCT FROM 'true'
    OR v_after->>'elegivel' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Replay de autorizacao poderia ignorar HOLD posterior: %',v_after;
 END IF;

 IF has_function_privilege('anon',
   'public.catalogo_asaas_validar_reserva_saque(uuid)','EXECUTE')
  OR has_function_privilege('authenticated',
   'public.catalogo_asaas_validar_reserva_saque(uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role',
   'public.catalogo_asaas_validar_reserva_saque(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Revalidacao de saque exposta a usuarios comuns'; END IF;

 RAISE NOTICE 'PASS: replay de autorizacao nao ignora hold bancario posterior';
END $authorization_revalidation$;


DO $historic_rights$
DECLARE
 v_uid uuid:='ffffffff-ffff-4fff-8fff-ffffffffffff';
 v_balance jsonb;
 v_pendencias jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);
 -- Sem associacao em catalogo_motoboys, e sem comissoes, o saldo fica 0.
 IF EXISTS(SELECT 1 FROM public.catalogo_motoboys m WHERE m.usuario_id=v_uid) THEN
  RAISE EXCEPTION 'Fixture nao representa ex-entregador sem vinculo';
 END IF;
 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_balance;
 SELECT public.catalogo_asaas_pendencias_historicas(v_uid) INTO v_pendencias;
 IF (v_balance->>'disponivel_centavos')::bigint <> 0
    OR (v_balance->>'creditos')::bigint<>0 OR v_pendencias<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Ex-entregador sem remuneracao recebeu creditos indevidos';
 END IF;

 -- O saldo deve depender apenas de remuneracoes em nome do titular,
 -- sem exigir linha de vinculo apos a ultima entrega.
 IF pg_catalog.pg_get_functiondef(
   'public.catalogo_asaas_saldo_historico(uuid)'::regprocedure
 ) LIKE '%FROM public.catalogo_motoboys%'
 OR pg_catalog.pg_get_functiondef(
   'public.catalogo_asaas_pendencias_historicas(uuid)'::regprocedure
 ) LIKE '%FROM public.catalogo_motoboys%' THEN
  RAISE EXCEPTION 'RPC ainda exige vinculo comercial para consultar saldo historico';
 END IF;
 IF has_function_privilege('anon','public.catalogo_asaas_saldo_historico(uuid)','EXECUTE')
    OR has_function_privilege('authenticated',
         'public.catalogo_asaas_pendencias_historicas(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'RPC de historico acessivel diretamente por clientes';
 END IF;
 RAISE NOTICE 'PASS: saldo historico sem vinculo depende exclusivamente de remuneracoes e nao vaza dados';
END $historic_rights$;


-- Fixture integralmente sintetica: comprovacao financeira de 7%, parcelas
-- 5%/2%, ledger do titular, remocao do ultimo vinculo e revisao residual.
-- Reproduzida em PostgreSQL DESCARTAVEL: transacao externa faz ROLLBACK.
DO $positive_orphan_balance$
DECLARE
 v_uid uuid := 'caca0a0a-caca-4caa-8caa-caca0a0a0a01';
 v_store text := 'ci-carteira-sem-vinculo-positivo';
 v_pedido uuid; v_fechamento uuid; v_residual uuid;
 v_before jsonb;v_after jsonb;v_pending jsonb;v_preflight jsonb;v_reserva jsonb;v_posreserva jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);
 INSERT INTO public.comercios_publicados(local_id,status) VALUES(v_store,'ativo');
 INSERT INTO public.catalogos(comercio_id,proprietario_id) VALUES(v_store,v_uid);
 INSERT INTO public.catalogo_motoboys(
  comercio_id,usuario_id,nome,email,ativo,autorizado_por
 ) VALUES(v_store,v_uid,'Motoboy CI','ci-historico@example.invalid',true,v_uid);

 INSERT INTO public.catalogo_pedidos(
  comercio_id,referencia_externa,provedor,idempotency_key,status,
  status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
  entrega_centavos,total_centavos,taxa_plataforma_centavos,
  repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
  versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
  entrega_status,metadata
 ) VALUES(
  v_store,'ci-historico-positivo-209905','offline',gen_random_uuid(),
  'entregue','aprovado','entrega','dinheiro',10000,
  0,10000,500,9300,'Cliente sintético','00000000000',
  2,200,700,'entregue','{"ensaio":"financeiro-sem-vinculo"}'::jsonb
 ) RETURNING id INTO v_pedido;

 INSERT INTO public.catalogo_fechamentos_offline(
  comercio_id,competencia,total_pedidos,total_comissao_centavos,status,pago_em
 ) VALUES(v_store,date '2099-05-01',1,700,'pago',now())
 RETURNING id INTO v_fechamento;

 INSERT INTO public.catalogo_fatura_componentes_v2(
  fechamento_id,pedido_id,tipo,valor_centavos
 ) VALUES
  (v_fechamento,v_pedido,'plataforma',500),
  (v_fechamento,v_pedido,'logistica',200);

 INSERT INTO public.catalogo_comissoes_offline(
  pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
  taxa_percentual,valor_comissao_centavos,status,pago_em,
  taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
  versao_financeira,motoboy_id,financiamento_logistica_comprovado
 ) VALUES(v_pedido,v_store,date '2099-05-01',10000,
  5,700,'paga',now(),500,200,700,2,v_uid,true);

 INSERT INTO public.catalogo_fatura_cobrancas(
  fechamento_id,comercio_id,competencia,gateway,
  payment_id,status,valor_centavos,pago_em
 ) VALUES(v_fechamento,v_store,date '2099-05-01','asaas',
  'ci-pagamento-ficticio','pago',700,now());

 IF NOT catalogo_private.catalogo_v2_financiado(v_pedido) THEN
  RAISE EXCEPTION 'Fixture sem comprovacao integral do financiamento da comissao';
 END IF;

 INSERT INTO public.catalogo_remuneracoes_v2(
  pedido_id,comercio_id,motoboy_id,valor_centavos,
  status,financiamento_comprovado
 ) VALUES(v_pedido,v_store,v_uid,200,'disponivel',true);

 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_before;
 IF (v_before->>'disponivel_centavos')::bigint<>200
 OR (v_before->>'creditos')::bigint<>1 THEN
  RAISE EXCEPTION 'Saldo positivo antes de desvincular nao encontrado: %',v_before;
 END IF;

 DELETE FROM public.catalogo_motoboys WHERE usuario_id=v_uid;
 IF EXISTS(SELECT 1 FROM public.catalogo_motoboys WHERE usuario_id=v_uid) THEN
  RAISE EXCEPTION 'Ainda existe vinculo comercial na fixture';
 END IF;

 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_after;
 SELECT public.catalogo_asaas_pendencias_historicas(v_uid) INTO v_pending;
 IF v_after IS DISTINCT FROM v_before OR v_pending<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Saldo positivo mudou apos ultimo vinculo removido: % -> % (%).',
   v_before,v_after,v_pending;
 END IF;

 INSERT INTO public.catalogo_asaas_saldos_residuais(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_uid,200,'inatividade') RETURNING id INTO v_residual;

 IF NOT EXISTS(
  SELECT 1 FROM public.catalogo_asaas_saldos_residuais
  WHERE id=v_residual AND status='pendente'
 ) THEN RAISE EXCEPTION 'Pedido residual sem vinculo nao foi registrado'; END IF;

 IF (public.catalogo_asaas_saldo_sacavel(v_uid)->>'disponivel_centavos')::bigint>0 THEN
  RAISE EXCEPTION 'Ex-motoboy sem vinculo recebeu autorizacao de saque comum';
 END IF;
 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('residual',v_residual)
  INTO v_preflight;
 IF v_preflight->>'composicao_creditos_integra' IS DISTINCT FROM 'true'
  OR v_preflight->>'creditos_individuais_validos' IS DISTINCT FROM '1'
  OR v_preflight->>'valor_creditos_individuais_centavos' IS DISTINCT FROM '200'
  OR length(v_preflight->>'fingerprint_creditos_sha256')<>64
  OR v_preflight->>'sem_impedimentos_identificados' IS DISTINCT FROM 'true'
  OR v_preflight->>'pagamento_autorizado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Preconferencia individual divergente ou autorizou pagamento: %',v_preflight;
 END IF;

 SELECT public.catalogo_asaas_separar_creditos_excepcionais('residual',v_residual)
 INTO v_reserva;
 IF v_reserva->>'ok' IS DISTINCT FROM 'true'
  OR v_reserva->>'creditos_separados' IS DISTINCT FROM '1'
  OR v_reserva->>'valor_centavos' IS DISTINCT FROM '200'
  OR v_reserva->>'pagamento_autorizado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Reserva residual abaixo de R$100 falhou: %',v_reserva;
 END IF;
 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('residual',v_residual)
 INTO v_posreserva;
 IF v_posreserva->>'separacoes_contabeis_sem_liquidacao' IS DISTINCT FROM '1'
  OR v_posreserva->>'sem_impedimentos_identificados' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'HOLD residual não bloqueou nova pré-conferência: %',v_posreserva;
 END IF;
 RAISE NOTICE 'PASS: saldo positivo de 200 centavos financiado, 1 credito e pedido residual preservados SEM ultimo vinculo';
END $positive_orphan_balance$;


-- Acumulo em duas competencias: 2 x R$ 60 = R$ 120, sem vinculo.
-- Nenhuma dessas faturas representa cobranca bancaria real.
DO $orphan_large_balance$
DECLARE
 v_uid uuid:='cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcd10';
 v_store text:='ci-saldo-saida-meses';
 v_pedido uuid;
 v_fechamento uuid;
 v_competencia date;
 v_i int;
 v_before jsonb;
 v_after jsonb;
 v_saida uuid;
 v_preflight jsonb;
 v_again jsonb;
 v_bank_response jsonb;
 v_after_bank jsonb;
 v_bank_fingerprint text;
 v_bank_count bigint;
 v_bank_amount bigint;
 v_bank_consistent boolean;
 v_blocks int:=0;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);
 INSERT INTO public.comercios_publicados(local_id,status) VALUES(v_store,'ativo');
 INSERT INTO public.catalogos(comercio_id,proprietario_id) VALUES(v_store,v_uid);
 INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,ativo,autorizado_por)
 VALUES(v_store,v_uid,'Entregador CI dois meses','test-exit@example.invalid',true,v_uid);

 FOR v_i IN 1..2 LOOP
  v_competencia:=make_date(2098,v_i,1);
  INSERT INTO public.catalogo_pedidos(
   comercio_id,referencia_externa,provedor,idempotency_key,status,
   status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
   entrega_centavos,total_centavos,taxa_plataforma_centavos,
   repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
   versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
   entrega_status,metadata
  ) VALUES(v_store,'ci-saldo-saida-'||v_i,'offline',gen_random_uuid(),
   'entregue','aprovado','entrega','dinheiro',300000,0,300000,15000,279000,
   'Cliente sintético','00000000000',2,6000,21000,'entregue',
   jsonb_build_object('ensaio','duas-competencias','mes',v_i))
  RETURNING id INTO v_pedido;

  INSERT INTO public.catalogo_fechamentos_offline(
    comercio_id,competencia,total_pedidos,total_comissao_centavos,status,pago_em
  ) VALUES(v_store,v_competencia,1,21000,'pago',now())
  RETURNING id INTO v_fechamento;

  INSERT INTO public.catalogo_fatura_componentes_v2(fechamento_id,pedido_id,tipo,valor_centavos)
  VALUES(v_fechamento,v_pedido,'plataforma',15000),
        (v_fechamento,v_pedido,'logistica',6000);

  INSERT INTO public.catalogo_comissoes_offline(
   pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
   taxa_percentual,valor_comissao_centavos,status,pago_em,
   taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
   versao_financeira,motoboy_id,financiamento_logistica_comprovado
  ) VALUES(v_pedido,v_store,v_competencia,300000,5,21000,'paga',now(),
   15000,6000,21000,2,v_uid,true);

  INSERT INTO public.catalogo_fatura_cobrancas(
   fechamento_id,comercio_id,competencia,gateway,
   payment_id,status,valor_centavos,pago_em
  ) VALUES(v_fechamento,v_store,v_competencia,'asaas',
   'ci-pagamento-2meses-'||v_i,'pago',21000,now());

  IF NOT catalogo_private.catalogo_v2_financiado(v_pedido) THEN
   RAISE EXCEPTION 'Financiamento da competencia % nao valido',v_competencia;
  END IF;
  INSERT INTO public.catalogo_remuneracoes_v2(
   pedido_id,comercio_id,motoboy_id,valor_centavos,
   status,financiamento_comprovado
  ) VALUES(v_pedido,v_store,v_uid,6000,'disponivel',true);
 END LOOP;

 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_before;
 IF v_before->>'disponivel_centavos' <> '12000'
 OR v_before->>'creditos' <> '2' THEN
  RAISE EXCEPTION 'Acumulo de dois meses incorreto: %',v_before;
 END IF;

 DELETE FROM public.catalogo_motoboys WHERE usuario_id=v_uid;
 IF EXISTS (SELECT 1 FROM public.catalogo_motoboys WHERE usuario_id=v_uid)
 THEN RAISE EXCEPTION 'Motoboy ainda vinculado'; END IF;
 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_after;
 IF v_after IS DISTINCT FROM v_before OR
 (public.catalogo_asaas_saldo_sacavel(v_uid)->>'disponivel_centavos')::bigint <> 0
 THEN RAISE EXCEPTION 'Perda de saldo historico ou saque indevido: %, %',v_before,v_after; END IF;

 INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_uid,12000,'inatividade') RETURNING id INTO v_saida;
 IF NOT EXISTS(
  SELECT 1 FROM public.catalogo_asaas_regularizacoes_inativos
  WHERE id=v_saida AND status='pendente'
 ) THEN RAISE EXCEPTION 'Pedido de saida nao foi registrado'; END IF;

 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_saida)
 INTO v_preflight;
 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_saida)
 INTO v_again;
 IF v_preflight->>'composicao_creditos_integra' IS DISTINCT FROM 'true'
  OR v_preflight->>'creditos_individuais_validos' IS DISTINCT FROM '2'
  OR v_preflight->>'valor_creditos_individuais_centavos' IS DISTINCT FROM '12000'
  OR v_preflight->>'sem_impedimentos_identificados' IS DISTINCT FROM 'true'
  OR v_preflight->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR length(v_preflight->>'fingerprint_creditos_sha256')<>64
  OR v_preflight->>'fingerprint_creditos_sha256'
    IS DISTINCT FROM v_again->>'fingerprint_creditos_sha256' THEN
  RAISE EXCEPTION 'Comissoes individuais ou fingerprint nao conferem: %',v_preflight;
 END IF;

 BEGIN
  INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,12000,'inatividade');
  RAISE EXCEPTION 'Permitiu pedido de saida em duplicidade';
 EXCEPTION WHEN unique_violation OR check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_saldos_residuais(
   motoboy_id,saldo_snapshot_centavos,motivo
  ) VALUES(v_uid,9500,'inatividade');
  RAISE EXCEPTION 'Permitiu revisao residual enquanto saida em aberto';
 EXCEPTION WHEN unique_violation OR check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
  VALUES(v_uid,12000);
  RAISE EXCEPTION 'Permitiu saque comum sem vinculo durante saida';
 EXCEPTION WHEN unique_violation OR check_violation THEN v_blocks:=v_blocks+1;
 END;
 IF v_blocks<>3 THEN RAISE EXCEPTION 'Esperados 3 bloqueios; obtidos %',v_blocks; END IF;

 -- Observacao bancaria NO SANDBOX nao prova titular nem baixa valores.
 -- O trigger captura a composicao de creditos INDEPENDENTEMENTE do cliente.
 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_saida,'ci_bank_snapshot_12k',
  'guia-exc:saida:'||v_saida,12000,'DONE'
 ) INTO v_bank_response;
 IF v_bank_response->>'ok' IS DISTINCT FROM 'true'
  OR v_bank_response->>'pagamento_baixado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Observacao do banco baixou valores ou foi rejeitada: %',v_bank_response;
 END IF;
 SELECT creditos_fingerprint_observado_sha256,creditos_observados,
  valor_creditos_observados_centavos,composicao_conferida_na_observacao
 INTO v_bank_fingerprint,v_bank_count,v_bank_amount,v_bank_consistent
 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria
 WHERE tipo='saida' AND solicitacao_id=v_saida;
 IF v_bank_fingerprint IS DISTINCT FROM v_preflight->>'fingerprint_creditos_sha256'
 OR v_bank_count<>2 OR v_bank_amount<>12000 OR v_bank_consistent IS NOT TRUE THEN
  RAISE EXCEPTION 'Foto de creditos bancarios nao corresponde a preconferencia: % % % %',
  v_bank_fingerprint,v_bank_count,v_bank_amount,v_bank_consistent;
 END IF;
 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_saida)
 INTO v_after_bank;
 IF v_after_bank->>'evidencias_bancarias_para_conciliar' IS DISTINCT FROM '1'
  OR v_after_bank->>'sem_impedimentos_identificados' IS DISTINCT FROM 'false'
  OR v_after_bank->>'pagamento_autorizado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Preconferencia ignorou HOLD depois de evidência bancaria: %',v_after_bank;
 END IF;

 RAISE NOTICE 'PASS: 2 meses (R$120), 2 creditos, sem ultimo vinculo, saida pendente e 3 reservas duplicadas bloqueadas';
END $orphan_large_balance$;


-- O trigger de evidencia excepcional adquire a mesma trava por motoboy do
-- saque comum, inclusive quando a observacao vem tardiamente.
DO $bank_evidence_serialized$
DECLARE
 v_a uuid:='fadafada-fada-4ada-8ada-fadafada0001';
 v_b uuid:='fadafada-fada-4ada-8ada-fadafada0002';
 v_req uuid;
 v_blocks int:=0;
 v_result jsonb;
 v_trigger text;
 v_function text;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_a),(v_b);
 INSERT INTO public.catalogo_asaas_saldos_residuais(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_a,250,'inatividade') RETURNING id INTO v_req;

 BEGIN
  INSERT INTO public.catalogo_asaas_transferencias_excepcionais_auditoria(
   tipo,solicitacao_id,motoboy_id,valor_centavos,
   transferencia_id,referencia_externa)
  VALUES('residual',v_req,v_b,250,'ci_wrong_owner_01',
   'guia-exc:residual:'||v_req);
  RAISE EXCEPTION 'Evidencia aceita com titular diferente';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_transferencias_excepcionais_auditoria(
   tipo,solicitacao_id,motoboy_id,valor_centavos,
   transferencia_id,referencia_externa)
  VALUES('residual',v_req,v_a,251,'ci_wrong_amount_01',
   'guia-exc:residual:'||v_req);
  RAISE EXCEPTION 'Evidencia aceita com valor adulterado';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;

 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'residual',v_req,'ci_valid_hold_01',
  'guia-exc:residual:'||v_req,250,'DONE'
 ) INTO v_result;
 IF v_result->>'ok' IS DISTINCT FROM 'true'
  OR v_result->>'pagamento_baixado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Observacao bancaria validada incorretamente: %',v_result;
 END IF;

 SELECT pg_get_triggerdef(t.oid) INTO v_trigger
 FROM pg_trigger t
 WHERE t.tgrelid='public.catalogo_asaas_transferencias_excepcionais_auditoria'::regclass
 AND t.tgname='catalogo_asaas_serializar_evidencia_excepcional';
 SELECT pg_get_functiondef(
  'catalogo_private.catalogo_asaas_evidencia_excepcional_serializada()'::regprocedure
 ) INTO v_function;
 IF v_trigger NOT LIKE '%BEFORE INSERT%'
 OR v_function NOT LIKE '%hashtextextended(''asaas-saque:''%'
 OR v_function NOT LIKE '%v_valor IS DISTINCT FROM NEW.valor_centavos%' THEN
  RAISE EXCEPTION 'Evidencia sem trava compartilhada de saldo/titular';
 END IF;

 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
  VALUES(v_a,10000);
  RAISE EXCEPTION 'Permitiu saque comum durante observacao bancaria';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 IF v_blocks<>3 THEN RAISE EXCEPTION 'Esperados 3 bloqueios; obtidos %',v_blocks; END IF;
 RAISE NOTICE 'PASS: banco exige mesmo lock, titular, valor e bloqueia reserva duplicada';
END $bank_evidence_serialized$;


-- Ensaio de escrow sem pagamento. Todas as linhas são revertidas.
DO $escrow_creditos$
DECLARE
 v_uid uuid:='edededed-eded-4ede-8ede-ededededed10';
 v_store text:='ci-escrow-creditos-finais';
 v_pedido uuid;
 v_fechamento uuid;
 v_competencia date;
 v_i int;
 v_before jsonb;
 v_after jsonb;
 v_saida uuid;
 v_preflight jsonb;
 v_again jsonb;
 v_bank_response jsonb;
 v_after_bank jsonb;
 v_bank_fingerprint text;
 v_bank_count bigint;
 v_bank_amount bigint;
 v_bank_consistent boolean;
 v_blocks int:=0;
 v_saldo jsonb;
 v_reserva jsonb;
 v_duplicada jsonb;
 v_posreserva jsonb;
 v_item uuid;
 v_qty bigint;
 v_sum bigint;
 v_diagnostico jsonb;
 v_diagnostico_banco jsonb;
 v_diagnostico_reversao jsonb;
 v_evidencia jsonb;
 v_note1 jsonb;
 v_repeat jsonb;
 v_note2 jsonb;
 v_replay_err jsonb;
 v_notes bigint;
 v_seq2 bigint;
 v_prev_hash text;
 v_hash1 text;
 v_auditoria_integridade jsonb;
 v_falsificacao jsonb;
 v_nota_bloqueada jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid);
 INSERT INTO public.comercios_publicados(local_id,status) VALUES(v_store,'ativo');
 INSERT INTO public.catalogos(comercio_id,proprietario_id) VALUES(v_store,v_uid);
 INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,ativo,autorizado_por)
 VALUES(v_store,v_uid,'Entregador CI dois meses','test-exit@example.invalid',true,v_uid);

 FOR v_i IN 1..2 LOOP
  v_competencia:=make_date(2098,v_i,1);
  INSERT INTO public.catalogo_pedidos(
   comercio_id,referencia_externa,provedor,idempotency_key,status,
   status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
   entrega_centavos,total_centavos,taxa_plataforma_centavos,
   repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
   versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
   entrega_status,metadata
  ) VALUES(v_store,'ci-escrow-creditos-'||v_i,'offline',gen_random_uuid(),
   'entregue','aprovado','entrega','dinheiro',300000,0,300000,15000,279000,
   'Cliente sintético','00000000000',2,6000,21000,'entregue',
   jsonb_build_object('ensaio','duas-competencias','mes',v_i))
  RETURNING id INTO v_pedido;

  INSERT INTO public.catalogo_fechamentos_offline(
    comercio_id,competencia,total_pedidos,total_comissao_centavos,status,pago_em
  ) VALUES(v_store,v_competencia,1,21000,'pago',now())
  RETURNING id INTO v_fechamento;

  INSERT INTO public.catalogo_fatura_componentes_v2(fechamento_id,pedido_id,tipo,valor_centavos)
  VALUES(v_fechamento,v_pedido,'plataforma',15000),
        (v_fechamento,v_pedido,'logistica',6000);

  INSERT INTO public.catalogo_comissoes_offline(
   pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
   taxa_percentual,valor_comissao_centavos,status,pago_em,
   taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
   versao_financeira,motoboy_id,financiamento_logistica_comprovado
  ) VALUES(v_pedido,v_store,v_competencia,300000,5,21000,'paga',now(),
   15000,6000,21000,2,v_uid,true);

  INSERT INTO public.catalogo_fatura_cobrancas(
   fechamento_id,comercio_id,competencia,gateway,
   payment_id,status,valor_centavos,pago_em
  ) VALUES(v_fechamento,v_store,v_competencia,'asaas',
   'ci-pagamento-escrow-'||v_i,'pago',21000,now());

  IF NOT catalogo_private.catalogo_v2_financiado(v_pedido) THEN
   RAISE EXCEPTION 'Financiamento da competencia % nao valido',v_competencia;
  END IF;
  INSERT INTO public.catalogo_remuneracoes_v2(
   pedido_id,comercio_id,motoboy_id,valor_centavos,
   status,financiamento_comprovado
  ) VALUES(v_pedido,v_store,v_uid,6000,'disponivel',true);
 END LOOP;

 SELECT public.catalogo_asaas_saldo_historico(v_uid) INTO v_saldo;
 IF (v_saldo->>'disponivel_centavos')::bigint<>12000
 THEN RAISE EXCEPTION 'Fixture sem 12000 centavos comprovados'; END IF;
 DELETE FROM public.catalogo_motoboys WHERE usuario_id=v_uid;
 INSERT INTO public.catalogo_asaas_regularizacoes_inativos(
  motoboy_id,saldo_snapshot_centavos,motivo
 ) VALUES(v_uid,12000,'inatividade') RETURNING id INTO v_saida;

 SELECT public.catalogo_asaas_separar_creditos_excepcionais('saida',v_saida) INTO v_reserva;
 IF v_reserva->>'ok' IS DISTINCT FROM 'true'
  OR v_reserva->>'creditos_separados' IS DISTINCT FROM '2'
  OR v_reserva->>'valor_centavos' IS DISTINCT FROM '12000'
  OR v_reserva->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR v_reserva->>'baixa_realizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Separacao contábil não confirmou dois créditos: %',v_reserva; END IF;
 SELECT count(*),sum(valor_centavos)::bigint INTO v_qty,v_sum
 FROM public.catalogo_asaas_separacoes_excepcionais_itens
 WHERE separacao_id=(v_reserva->>'separacao_id')::uuid;
 IF v_qty<>2 OR v_sum<>12000 THEN
  RAISE EXCEPTION 'Itens separados incorretos: % %',v_qty,v_sum; END IF;

 SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_saida)
 INTO v_posreserva;
 IF v_posreserva->>'separacoes_contabeis_sem_liquidacao' IS DISTINCT FROM '1'
 OR v_posreserva->>'sem_impedimentos_identificados' IS DISTINCT FROM 'false'
 OR v_posreserva->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 OR v_posreserva->>'fingerprint_creditos_sha256'
  IS DISTINCT FROM v_reserva->>'fingerprint_sha256' THEN
  RAISE EXCEPTION 'Pré-conferência não mostra HOLD contábil: %',v_posreserva;
 END IF;

 SELECT public.catalogo_asaas_separar_creditos_excepcionais('saida',v_saida) INTO v_duplicada;
 IF v_duplicada->>'ok' IS DISTINCT FROM 'false'
 OR v_duplicada->>'separacao_id' IS DISTINCT FROM v_reserva->>'separacao_id' THEN
  RAISE EXCEPTION 'Reserva duplicada sem idempotência de referência: %',v_duplicada; END IF;
 SELECT remuneracao_id INTO v_item
 FROM public.catalogo_asaas_separacoes_excepcionais_itens
 WHERE separacao_id=(v_reserva->>'separacao_id')::uuid LIMIT 1;

 BEGIN
  UPDATE public.catalogo_remuneracoes_v2 SET valor_centavos=valor_centavos+1
   WHERE id=v_item;
  RAISE EXCEPTION 'Crédito separado sofreu adulteração';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  UPDATE public.catalogo_remuneracoes_v2 SET status='pago',pago_em=now()
   WHERE id=v_item;
  RAISE EXCEPTION 'Crédito separado recebeu baixa artificial';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
   VALUES(v_uid,12000);
  RAISE EXCEPTION 'Saque comum criado sobre separação excepcional';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 IF v_blocks<>3 THEN RAISE EXCEPTION 'Esperados três bloqueios, obtidos %',v_blocks; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2
  WHERE id=v_item AND status='disponivel' AND repasse_id IS NULL) THEN
  RAISE EXCEPTION 'Crédito foi liquidado indevidamente'; END IF;

 IF has_function_privilege('anon',
   'public.catalogo_asaas_separar_creditos_excepcionais(text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.catalogo_asaas_separar_creditos_excepcionais(text,uuid)','EXECUTE')
 OR has_table_privilege('service_role',
   'public.catalogo_asaas_separacoes_excepcionais_itens','INSERT')
 THEN RAISE EXCEPTION 'Permissões do escrow estão abertas demais'; END IF;
 -- Anotacoes humanas jamais podem se transformar em ordem de Pix.
 SELECT public.catalogo_asaas_registrar_evento_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid,v_uid,
  'fafa1111-2222-4333-8444-555555555551'::uuid,
  'verificacao_banco',
  'Consulta administrativa ao historico bancario realizada: conferencia pendente de prova externa.'
 ) INTO v_note1;
 IF v_note1->>'ok' IS DISTINCT FROM 'true'
  OR v_note1->>'seq' IS DISTINCT FROM '1'
  OR v_note1->>'repetido' IS DISTINCT FROM 'false'
  OR v_note1->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR v_note1->>'liberacao_autorizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Registro sequencial inicial inseguro: %',v_note1; END IF;

 SELECT public.catalogo_asaas_registrar_evento_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid,v_uid,
  'fafa1111-2222-4333-8444-555555555551'::uuid,
  'verificacao_banco',
  'Consulta administrativa ao historico bancario realizada: conferencia pendente de prova externa.'
 ) INTO v_repeat;
 IF v_repeat->>'repetido' IS DISTINCT FROM 'true'
  OR v_repeat->>'evento_id' IS DISTINCT FROM v_note1->>'evento_id'
 THEN RAISE EXCEPTION 'Chave idempotente gerou duplicata: %',v_repeat; END IF;

 SELECT public.catalogo_asaas_registrar_evento_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid,v_uid,
  'fafa1111-2222-4333-8444-555555555551'::uuid,
  'contestacao',
  'Uma contestacao distinta nao pode reutilizar chave de outra ocorrencia.'
 ) INTO v_replay_err;
 IF v_replay_err->>'ok' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Chave reaproveitada com conteudo diferente: %',v_replay_err; END IF;

 SELECT public.catalogo_asaas_registrar_evento_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid,v_uid,
  'fafa1111-2222-4333-8444-555555555552'::uuid,
  'comprovante_externo',
  'Documento recebido fora do aplicativo para conferir conta do beneficiario, sem confirmar pagamento.',
  repeat('a',64)
 ) INTO v_note2;
 IF v_note2->>'seq' IS DISTINCT FROM '2'
 OR v_note2->>'baixa_realizada' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Segundo registro autorizou baixa ou perdeu ordem: %',v_note2;
 END IF;

 SELECT count(*)::bigint INTO v_notes
 FROM public.catalogo_asaas_escrow_dossie_eventos
 WHERE separacao_id=(v_reserva->>'separacao_id')::uuid;
 SELECT seq,hash_anterior_sha256 INTO v_seq2,v_prev_hash
 FROM public.catalogo_asaas_escrow_dossie_eventos
 WHERE id=(v_note2->>'evento_id')::uuid;
 SELECT evento_sha256 INTO v_hash1
 FROM public.catalogo_asaas_escrow_dossie_eventos
 WHERE id=(v_note1->>'evento_id')::uuid;
 IF v_notes<>2 OR v_seq2<>2 OR v_prev_hash IS DISTINCT FROM v_hash1
  OR length(v_hash1)<>64 THEN
  RAISE EXCEPTION 'Encadeamento de auditoria incorreto: % % % %',
   v_notes,v_seq2,v_prev_hash,v_hash1;
 END IF;
 IF has_function_privilege('anon',
   'public.catalogo_asaas_registrar_evento_dossie_escrow(uuid,uuid,uuid,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.catalogo_asaas_registrar_evento_dossie_escrow(uuid,uuid,uuid,text,text,text)','EXECUTE')
 OR has_table_privilege('service_role','public.catalogo_asaas_escrow_dossie_eventos','INSERT')
 THEN RAISE EXCEPTION 'Dossie admin possui permissao indevida'; END IF;

 -- Valida cada evento reconstituindo JSONB canonico, hash e sequencia.
 SELECT public.catalogo_asaas_verificar_integridade_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid) INTO v_auditoria_integridade;
 IF v_auditoria_integridade->>'integridade_valida' IS DISTINCT FROM 'true'
 OR v_auditoria_integridade->>'numero_eventos' IS DISTINCT FROM '2'
 OR v_auditoria_integridade->>'liberacao_autorizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Verificador acusou trilha integra como invalida: %',v_auditoria_integridade; END IF;

 BEGIN
  UPDATE public.catalogo_asaas_escrow_dossie_eventos SET descricao=
   'Texto administrativo de adulteracao manual que deve ser rejeitada pelo trigger.'
  WHERE id=(v_note1->>'evento_id')::uuid;
  RAISE EXCEPTION 'Dossie aceitou UPDATE indevido';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 BEGIN
  DELETE FROM public.catalogo_asaas_escrow_dossie_eventos
  WHERE id=(v_note1->>'evento_id')::uuid;
  RAISE EXCEPTION 'Dossie aceitou DELETE indevido';
 EXCEPTION WHEN check_violation THEN v_blocks:=v_blocks+1;
 END;
 IF v_blocks<>5 THEN RAISE EXCEPTION 'Esperados 5 bloqueios contabeis, obtidos %',v_blocks; END IF;

 -- Injeta linha artificial errada com permissao privilegiada do SQL isolado.
 -- Em ambiente real service_role NAO tem INSERT; a RPC jamais faz isto.
 INSERT INTO public.catalogo_asaas_escrow_dossie_eventos(
  separacao_id,seq,chave_idempotencia,autor_id,categoria,descricao,
  hash_anterior_sha256,evento_sha256)
 VALUES((v_reserva->>'separacao_id')::uuid,3,
  'fafa1111-2222-4333-8444-555555555553'::uuid,v_uid,'divergencia',
  'Linha falsificada diretamente pelo administrador do banco no ensaio de integridade.',
  repeat('0',64),repeat('b',64));
 SELECT public.catalogo_asaas_verificar_integridade_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid) INTO v_falsificacao;
 IF v_falsificacao->>'integridade_valida' IS DISTINCT FROM 'false'
 OR v_falsificacao->>'numero_eventos' IS DISTINCT FROM '3'
 OR v_falsificacao->>'liberacao_autorizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Dossie adulterado nao identificado: %',v_falsificacao; END IF;

 SELECT public.catalogo_asaas_registrar_evento_dossie_escrow(
  (v_reserva->>'separacao_id')::uuid,v_uid,
  'fafa1111-2222-4333-8444-555555555554'::uuid,'parecer_pendente',
  'Ocorrencia futura deve ser rejeitada pois a cadeia anterior perdeu integridade.'
 ) INTO v_nota_bloqueada;
 IF v_nota_bloqueada->>'ok' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Trilha adulterada permitiu novo append: %',v_nota_bloqueada; END IF;

 IF has_function_privilege('anon',
 'public.catalogo_asaas_verificar_integridade_dossie_escrow(uuid)','EXECUTE')
 OR has_function_privilege('authenticated',
 'public.catalogo_asaas_verificar_integridade_dossie_escrow(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Verificacao de dossie exposta a usuarios comuns'; END IF;

 -- Diagnostico da separacao e SOMENTE LEITURA: nunca liberar/pagar.
 SELECT public.catalogo_asaas_diagnosticar_separacao_excepcional(
  (v_reserva->>'separacao_id')::uuid) INTO v_diagnostico;
 IF v_diagnostico->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
  OR v_diagnostico->>'quantidade_encontrada' IS DISTINCT FROM '2'
  OR v_diagnostico->>'saldo_separado_centavos' IS DISTINCT FROM '12000'
  OR v_diagnostico->>'observacoes_bancarias_total' IS DISTINCT FROM '0'
  OR v_diagnostico->>'liberacao_automatica_autorizada' IS DISTINCT FROM 'false'
  OR v_diagnostico->>'quitacao_automatica_autorizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Diagnostico sem banco nao reteve saldos: %',v_diagnostico; END IF;

 -- Mesmo um DONE tardio deve aparecer como prova e NAO liberar creditos.
 SELECT public.catalogo_asaas_registrar_observacao_excepcional(
  'saida',v_saida,'ci_audit_frozen_120',
  'guia-exc:saida:'||v_saida,12000,'DONE') INTO v_evidencia;
 IF v_evidencia->>'ok' IS DISTINCT FROM 'true'
 OR v_evidencia->>'pagamento_baixado' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Evidencia bancaria deveria ser apenas auditoria: %',v_evidencia; END IF;
 SELECT public.catalogo_asaas_diagnosticar_separacao_excepcional(
  (v_reserva->>'separacao_id')::uuid) INTO v_diagnostico_banco;
 IF v_diagnostico_banco->>'observacoes_bancarias_total' IS DISTINCT FROM '1'
  OR v_diagnostico_banco->>'observacoes_done' IS DISTINCT FROM '1'
  OR v_diagnostico_banco->>'liberacao_automatica_autorizada' IS DISTINCT FROM 'false'
  OR v_diagnostico_banco->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Evidencia DONE nao reteve HOLD: %',v_diagnostico_banco; END IF;

 -- Perda de financiamento de um dos 2 creditos: HOLD e alerta, nunca baixa.
 UPDATE public.catalogo_remuneracoes_v2
 SET status='retido',financiamento_comprovado=false WHERE id=v_item;
 SELECT public.catalogo_asaas_diagnosticar_separacao_excepcional(
  (v_reserva->>'separacao_id')::uuid) INTO v_diagnostico_reversao;
 IF v_diagnostico_reversao->>'creditos_financeiramente_invalidos' IS DISTINCT FROM '1'
  OR v_diagnostico_reversao->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'false'
  OR v_diagnostico_reversao->>'liberacao_automatica_autorizada' IS DISTINCT FROM 'false'
  OR v_diagnostico_reversao->>'quitacao_automatica_autorizada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Estorno nao identificado: %',v_diagnostico_reversao; END IF;

 IF has_function_privilege('anon',
 'public.catalogo_asaas_diagnosticar_separacao_excepcional(uuid)','EXECUTE')
 OR has_function_privilege('authenticated',
 'public.catalogo_asaas_diagnosticar_separacao_excepcional(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Diagnostico do escrow ficou publico'; END IF;
 RAISE NOTICE 'PASS: 2 itens (R$120), separação contábil bloqueia baixa, saque comum e duplicação; zero Pix';
END $escrow_creditos$;

ROLLBACK;
