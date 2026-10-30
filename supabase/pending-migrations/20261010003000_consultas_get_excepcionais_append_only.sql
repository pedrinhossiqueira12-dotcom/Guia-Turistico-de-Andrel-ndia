-- #41: preservar CADA GET observado, inclusive repeticoes do mesmo estado.
-- Nao confiar na tabela historica (UNIQUE vinculo_id,estado_banco) para cronologia completa.
-- Esta migration NAO cria Pix, nao conclui saque e nao altera creditos.
BEGIN;

CREATE TABLE public.catalogo_asaas_consultas_get_excepcionais (
 id uuid PRIMARY KEY,
 vinculo_id uuid NOT NULL REFERENCES public.catalogo_asaas_transferencias_excepcionais_auditoria(id)
   ON DELETE RESTRICT,
 transferencia_id text NOT NULL,
 estado_banco text NOT NULL CHECK(estado_banco IN(
   'PENDING','IN_BANK_PROCESSING','BLOCKED','DONE','FAILED','CANCELLED')),
 registrado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX catalogo_asaas_consultas_get_excepcionais_vinculo_tempo_idx
 ON public.catalogo_asaas_consultas_get_excepcionais(vinculo_id,registrado_em,id);
ALTER TABLE public.catalogo_asaas_consultas_get_excepcionais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_consultas_get_excepcionais
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_consultas_get_excepcionais TO service_role;

CREATE FUNCTION catalogo_private.catalogo_asaas_get_apenas_append()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Consulta bancaria append-only: UPDATE e DELETE proibidos'
   USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_get_apenas_append()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_consultas_get_imutaveis
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_consultas_get_excepcionais
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_get_apenas_append();

-- Chave de cada GET gerada no servidor DEPOIS da resposta da API Asaas.
-- Repeticao do mesmo UUID e mesmos dados e idempotente; nova consulta cria
-- novo evento mesmo quando o estado bancario e identico ao GET anterior.
CREATE FUNCTION public.catalogo_asaas_registrar_consulta_get_excepcional(
 p_tipo text,p_solicitacao uuid,p_transferencia text,p_referencia text,
 p_valor_centavos bigint,p_estado text,p_consulta_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $record$
DECLARE
 v_antigo jsonb;
 v_atual public.catalogo_asaas_consultas_get_excepcionais%ROWTYPE;
 v_link public.catalogo_asaas_transferencias_excepcionais_auditoria%ROWTYPE;
BEGIN
 IF p_consulta_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Identificador de consulta ausente.');
 END IF;
 -- Serializa tentativas concorrentes que reutilizam a MESMA chave.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('guia-exc-consulta:'||p_consulta_id::text,0)
 );
 SELECT * INTO v_atual
 FROM public.catalogo_asaas_consultas_get_excepcionais
 WHERE id=p_consulta_id;
 IF FOUND THEN
  SELECT * INTO v_link
  FROM public.catalogo_asaas_transferencias_excepcionais_auditoria
  WHERE id=v_atual.vinculo_id;
  IF v_link.tipo IS DISTINCT FROM p_tipo
   OR v_link.solicitacao_id IS DISTINCT FROM p_solicitacao
   OR v_link.transferencia_id IS DISTINCT FROM p_transferencia
   OR v_link.referencia_externa IS DISTINCT FROM p_referencia
   OR v_link.valor_centavos IS DISTINCT FROM p_valor_centavos
   OR v_atual.transferencia_id IS DISTINCT FROM p_transferencia
   OR v_atual.estado_banco IS DISTINCT FROM p_estado THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Chave de GET reutilizada com dados divergentes.');
  END IF;
  RETURN jsonb_build_object('ok',true,'vinculo_id',v_link.id,
   'consulta_id',v_atual.id,'consulta_nova',false,'estado_observado',v_atual.estado_banco,
   'pagamento_baixado',false,'transferencia_gerada',false,
   'requer_validacao_destinatario',true);
 END IF;

 -- Preserva os mesmos checks de tipo, valor, referencia, dono e lock do saque.
 v_antigo:=public.catalogo_asaas_registrar_observacao_excepcional(
  p_tipo,p_solicitacao,p_transferencia,p_referencia,p_valor_centavos,p_estado);
 IF v_antigo->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_antigo; END IF;
 SELECT * INTO v_link FROM public.catalogo_asaas_transferencias_excepcionais_auditoria
  WHERE id=(v_antigo->>'vinculo_id')::uuid;
 IF v_link.id IS NULL
  OR v_link.transferencia_id IS DISTINCT FROM p_transferencia
  OR v_link.tipo IS DISTINCT FROM p_tipo
  OR v_link.solicitacao_id IS DISTINCT FROM p_solicitacao THEN
  RAISE EXCEPTION 'Vinculo inconsistente ao registrar consulta do banco'
   USING ERRCODE='23514';
 END IF;

 INSERT INTO public.catalogo_asaas_consultas_get_excepcionais
  (id,vinculo_id,transferencia_id,estado_banco)
 VALUES(p_consulta_id,v_link.id,p_transferencia,p_estado);
 RETURN jsonb_build_object('ok',true,'vinculo_id',v_link.id,
  'consulta_id',p_consulta_id,'consulta_nova',true,'estado_observado',p_estado,
  'pagamento_baixado',false,'transferencia_gerada',false,
  'requer_validacao_destinatario',true,
  'historico_anterior_completo_comprovado',false);
END $record$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_consulta_get_excepcional(
 text,uuid,text,text,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_consulta_get_excepcional(
 text,uuid,text,text,bigint,text,uuid) TO service_role;

-- Somente leitura: expor total real de consultas e suas repeticoes sem PII.
-- O desempate por UUID serve para exibir eventos, NAO para provar sequencia bancaria.
CREATE FUNCTION public.catalogo_asaas_diagnosticar_consultas_get_escrow(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $diagnostico$
DECLARE
 v_separacao public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_total bigint;
 v_repetidos bigint;
 v_regressos bigint;
 v_empates bigint;
 v_ultimo text;
BEGIN
 SELECT * INTO v_separacao FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separacao inexistente.');
 END IF;
 WITH eventos AS (
  SELECT c.estado_banco,c.registrado_em,
   pg_catalog.lag(c.estado_banco) OVER(ORDER BY c.registrado_em,c.id) AS anterior,
   pg_catalog.lag(c.registrado_em) OVER(ORDER BY c.registrado_em,c.id) AS horario_anterior
  FROM public.catalogo_asaas_consultas_get_excepcionais c
  JOIN public.catalogo_asaas_transferencias_excepcionais_auditoria e
   ON e.id=c.vinculo_id
  WHERE e.tipo=v_separacao.tipo AND e.solicitacao_id=v_separacao.solicitacao_id
 )
 SELECT count(*)::bigint,
  count(*) FILTER(WHERE estado_banco=anterior)::bigint,
  count(*) FILTER(WHERE anterior IN('DONE','FAILED','CANCELLED')
   AND estado_banco IN('PENDING','IN_BANK_PROCESSING','BLOCKED'))::bigint,
  count(*) FILTER(WHERE horario_anterior=registrado_em)::bigint
 INTO v_total,v_repetidos,v_regressos,v_empates
 FROM eventos;
 SELECT c.estado_banco INTO v_ultimo
 FROM public.catalogo_asaas_consultas_get_excepcionais c
 JOIN public.catalogo_asaas_transferencias_excepcionais_auditoria e
 ON e.id=c.vinculo_id
 WHERE e.tipo=v_separacao.tipo AND e.solicitacao_id=v_separacao.solicitacao_id
 ORDER BY c.registrado_em DESC,c.id DESC LIMIT 1;

 RETURN jsonb_build_object(
  'ok',true,'consultas_get_registradas',v_total,
  'consultas_com_mesmo_estado_consecutivo',v_repetidos,
  'consultas_com_retorno_a_processamento',v_regressos,
  'consultas_com_horarios_iguais',v_empates,
  'ultimo_get_observado_nao_conclusivo',v_ultimo,
  'historico_anterior_a_migracao_comprovado',false,
  'titularidade_pix_confirmada',false,'ausencia_de_pix_anterior_comprovada',false,
  'pagamento_autorizado',false,'baixa_realizada',false,'liberacao_autorizada',false,
  'aviso','Historico de GETs locais, nao de liquidacoes bancarias; manter HOLD.'
 );
END $diagnostico$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_diagnosticar_consultas_get_escrow(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_diagnosticar_consultas_get_escrow(uuid)
 TO service_role;
COMMENT ON TABLE public.catalogo_asaas_consultas_get_excepcionais IS
 'GETs locais append-only, com idempotencia por UUID. Nao provam destino Pix, pagamento ou ausencia de transferencia previa.';
COMMIT;
