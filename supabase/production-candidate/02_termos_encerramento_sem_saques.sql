-- CANDIDATO COB-06: SOMENTE CLONE DESCARTAVEL (nao executar em producao).
-- Extraido de 20261009150000_termos_cobranca_futura_encerramento_e_saque_minimo.sql
-- Escopo: preferencias de cobranca, aceites de termos/privacidade e encerramento.
-- Exclui deliberadamente reservador e minimo de saques da migration original.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_cobranca_preferencias(
 comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 metodo text NOT NULL DEFAULT 'pix_manual' CHECK (metodo IN ('pix_manual','pix_automatico')),
 status_autorizacao text NOT NULL DEFAULT 'nao_solicitada' CHECK (status_autorizacao IN ('nao_solicitada','pendente','autorizada','revogada')),
 mandato_provedor text UNIQUE,
 autorizado_em timestamptz,
 atualizado_em timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT catalogo_pix_automatico_sem_autorizacao_falsa CHECK (
  (metodo='pix_manual' AND mandato_provedor IS NULL AND autorizado_em IS NULL)
  OR (metodo='pix_automatico' AND status_autorizacao='autorizada' AND mandato_provedor IS NOT NULL AND autorizado_em IS NOT NULL)
 )
);
ALTER TABLE public.catalogo_cobranca_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_cobranca_preferencias FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_cobranca_preferencias TO service_role;
-- Nenhuma rotina nesta entrega cria autorizações automáticas nem debita o comerciante.

CREATE TABLE IF NOT EXISTS public.catalogo_aceites_operacionais(
 usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 papel text NOT NULL CHECK (papel IN ('comercio','motoboy')),
 comercio_id text NOT NULL DEFAULT '',
 documento text NOT NULL CHECK (documento IN ('termos','privacidade')),
 versao text NOT NULL,
 aceito_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(usuario_id,papel,comercio_id,documento,versao),
 CONSTRAINT catalogo_aceites_escopo CHECK(
   (papel='motoboy' AND comercio_id='') OR
   (papel='comercio' AND comercio_id<>'')
 )
);
CREATE INDEX IF NOT EXISTS catalogo_aceites_usuario_idx ON public.catalogo_aceites_operacionais(usuario_id,papel,comercio_id);
ALTER TABLE public.catalogo_aceites_operacionais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_aceites_operacionais FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.catalogo_aceites_operacionais TO service_role;
-- O aceite só é criado pelo backend após verificar JWT e titularidade; não há INSERT público.

CREATE TABLE IF NOT EXISTS public.catalogo_encerramentos_comercio(
 comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 solicitado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 situacao text NOT NULL CHECK (situacao IN ('aguardando_quitacao','pendente_arquivamento')),
 divida_apurada_centavos bigint NOT NULL DEFAULT 0 CHECK(divida_apurada_centavos>=0),
 solicitado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalogo_encerramentos_comercio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_encerramentos_comercio FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_encerramentos_comercio TO service_role;

-- A função é restrita à service_role. Emite diagnóstico SEM apagar faturas, comissões ou pedidos.
CREATE OR REPLACE FUNCTION public.catalogo_solicitar_encerramento_financeiro(
 p_comercio text,p_usuario uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $end$
DECLARE v_dono uuid;v_divida bigint:=0;v_faturas bigint:=0;v_pedidos bigint:=0;v_situacao text;
BEGIN
 IF p_comercio IS NULL OR p_usuario IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Identidade ou comércio inválido.');
 END IF;
 SELECT proprietario_id INTO v_dono FROM public.catalogos
 WHERE comercio_id=p_comercio FOR UPDATE;
 IF v_dono IS NULL OR v_dono<>p_usuario THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Somente o proprietário pode encerrar este comércio.');
 END IF;
 -- Fatura pendente e comissões ainda não faturadas são somadas sem contar duas vezes.
 SELECT coalesce(sum(f.total_comissao_centavos),0),count(*)
 INTO v_divida,v_faturas
 FROM public.catalogo_fechamentos_offline f
 WHERE f.comercio_id=p_comercio AND f.status<>'pago';
 SELECT v_divida+coalesce(sum(c.valor_total_centavos),0) INTO v_divida
 FROM public.catalogo_comissoes_offline c
 WHERE c.comercio_id=p_comercio
 AND c.status NOT IN ('paga','cancelada','contestada')
 AND NOT EXISTS (SELECT 1 FROM public.catalogo_fechamentos_offline f
                 WHERE f.comercio_id=c.comercio_id AND f.competencia=c.competencia);
 -- Pedidos ainda em processamento exigem fechamento, sem cancelar obrigações.
 SELECT count(*) INTO v_pedidos FROM public.catalogo_pedidos p
 WHERE p.comercio_id=p_comercio AND p.status NOT IN ('entregue','concluido','cancelado','reembolsado')
   AND p.entrega_status NOT IN ('entregue','nao_atribuido');
 v_situacao:=CASE WHEN v_divida>0 OR v_faturas>0 OR v_pedidos>0
  THEN 'aguardando_quitacao' ELSE 'pendente_arquivamento' END;
 INSERT INTO public.catalogo_encerramentos_comercio
 (comercio_id,solicitado_por,situacao,divida_apurada_centavos)
 VALUES(p_comercio,p_usuario,v_situacao,v_divida)
 ON CONFLICT(comercio_id) DO UPDATE SET
  solicitado_por=excluded.solicitado_por,situacao=excluded.situacao,
  divida_apurada_centavos=excluded.divida_apurada_centavos,atualizado_em=now();
 -- Interrompe novos pedidos IMEDIATAMENTE. O catálogo público será retirado na
 -- finalização administrativa; não altera pagamentos, faturas e histórico.
 UPDATE public.catalogos SET bloqueado=true,
  motivo_bloqueio='Encerramento solicitado pelo proprietário'
 WHERE comercio_id=p_comercio;
 RETURN jsonb_build_object('ok',true,'situacao',v_situacao,'divida_centavos',v_divida,
   'faturas_pendentes',v_faturas,'pedidos_em_andamento',v_pedidos,
   'mensagem',CASE WHEN v_situacao='aguardando_quitacao'
   THEN 'Novos pedidos suspensos. Quite suas faturas e conclua pedidos pendentes para finalizar o encerramento.'
   ELSE 'Novos pedidos suspensos. Encerramento aguardando retirada da vitrine pela administração.' END);
END;
$end$;
REVOKE ALL ON FUNCTION public.catalogo_solicitar_encerramento_financeiro(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_solicitar_encerramento_financeiro(text,uuid) TO service_role;

COMMIT;
