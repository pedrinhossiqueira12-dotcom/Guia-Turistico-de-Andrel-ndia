-- Uso EXCLUSIVO no clone PostgreSQL catalogo_cob06_race_ci.
-- Fixture sintetica de corridas reais em sessoes distintas; nunca em STAGING/PROD.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_cob06_race_ci'
    OR pg_catalog.to_regprocedure('catalogo_private.catalogo_cob06_realocar_entrega_congelada_ci()') IS NULL
    OR (SELECT count(*) FROM public.catalogo_comissoes_offline WHERE pedido_id IN (
       '00000000-0000-4000-8000-00000000c701',
       '00000000-0000-4000-8000-00000000c702',
       '00000000-0000-4000-8000-00000000c703'))<>0
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: fixture de concorrencia exige clone vazio'; END IF;
END;
$guard$;

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,
 provedor,modalidade,forma_pagamento,subtotal_produtos_centavos,
 entrega_centavos,total_centavos,taxa_plataforma_centavos,
 taxa_motoboy_centavos,taxa_total_centavos,repasse_bruto_comercio_centavos,
 versao_financeira,cliente_nome,cliente_telefone,status_token_hash,
 codigo_entrega_hash,codigo_entrega_expira_em,status,entrega_status,
 status_pagamento,aceito_em,codigo_entrega_usado_em
) VALUES
('00000000-0000-4000-8000-00000000c701','comercio-de-exemplo','cob06-race-entregue',
 '00000000-0000-4000-8000-00000000c711',
 'offline','entrega','dinheiro',4000,0,4000,200,80,280,3720,
 2,'CI Corrida Entregue','00000000000',repeat('1',64),repeat('a',64),
 '2040-01-31T00:00:00Z','entregue','entregue','aprovado',
 '2040-01-15T12:00:00Z','2040-01-15T13:00:00Z'),
('00000000-0000-4000-8000-00000000c702','comercio-de-exemplo','cob06-race-pendente',
 '00000000-0000-4000-8000-00000000c712',
 'offline','entrega','dinheiro',4000,0,4000,200,80,280,3720,
 2,'CI Corrida Pendente','00000000000',repeat('2',64),repeat('b',64),
 '2040-01-31T00:00:00Z','em_preparo','nao_atribuido','pendente',
 '2040-01-16T12:00:00Z',NULL),
('00000000-0000-4000-8000-00000000c703','comercio-de-exemplo','cob06-race-aceite',
 '00000000-0000-4000-8000-00000000c713',
 'offline','entrega','dinheiro',4000,0,4000,200,80,280,3720,
 2,'CI Corrida Novo Aceite','00000000000',repeat('3',64),repeat('c',64),
 '2040-01-31T00:00:00Z','em_preparo','nao_atribuido','pendente',
 '2040-01-17T12:00:00Z',NULL);

-- O terceiro pedido simula uma transacao interrompida ANTES de registrar
-- comissao no aceite (sem gravar lancamento financeiro pela metade).
DO $reg$
BEGIN
 IF catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c701','aceite') IS DISTINCT FROM true
    OR catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c702','aceite') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COB06_CI: fixture sem comissoes iniciais'; END IF;
 IF (SELECT count(*) FROM public.catalogo_comissoes_offline
     WHERE comercio_id='comercio-de-exemplo' AND competencia='2040-01-01')<>2
 THEN RAISE EXCEPTION 'COB06_CI: fixture teve competencia inesperada'; END IF;
END;
$reg$;
COMMIT;
