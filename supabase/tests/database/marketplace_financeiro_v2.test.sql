-- Testes pgTAP da finalização da lógica V2.
-- Executar com: supabase test db
-- Estes testes são estruturais e de regras; não movimentam dinheiro.

begin;

select plan(23);

update public.catalogo_fluxo_config
   set ativo=true, comercios_piloto=NULL
 where id=true;

select ok(
  exists(
    select 1 from public.catalogo_fluxo_config
    where id=true and taxa_sem_entrega_percentual=7.00
  ),
  'taxa configurada em 7%'
);

select results_eq(
  $$select (catalogo_fluxo_precificar('retirada',10000,NULL)->>'taxa_total_centavos')::integer$$,
  $$values (700)$$,
  'retirada cobra exatamente 7%'
);

select results_eq(
  $$select (catalogo_fluxo_precificar('consumo_local',10000,NULL)->>'taxa_total_centavos')::integer$$,
  $$values (700)$$,
  'consumo local cobra exatamente 7%'
);

select results_eq(
  $$select (catalogo_fluxo_precificar('entrega',10000,NULL)->>'taxa_total_centavos')::integer$$,
  $$values (700)$$,
  'entrega cobra exatamente 7%'
);

select results_eq(
  $$select (catalogo_fluxo_precificar('entrega',10000,NULL)->>'taxa_plataforma_centavos')::integer$$,
  $$values (500)$$,
  'entrega reserva 5% para a plataforma'
);

select results_eq(
  $$select (catalogo_fluxo_precificar('entrega',10000,NULL)->>'taxa_motoboy_centavos')::integer$$,
  $$values (200)$$,
  'entrega reserva 2% para o motoboy'
);

select ok(
  not exists(
    select 1 from public.catalogo_pedidos
    where versao_financeira=2
      and modalidade<>'entrega'
      and taxa_motoboy_centavos<>0
  ),
  'V2 sem entrega nunca cria remuneração de motoboy'
);

select ok(
  not exists(
    select 1 from public.catalogo_pedidos
    where versao_financeira=2
      and modalidade='entrega'
      and taxa_motoboy_centavos <>
          round(subtotal_produtos_centavos*0.02)::integer
  ),
  'V2 entrega mantém snapshot de 2% para motoboy'
);

select ok(
  not exists(
    select 1 from public.catalogo_pedidos
    where versao_financeira=2
      and taxa_total_centavos <>
          taxa_plataforma_centavos+taxa_motoboy_centavos
  ),
  'snapshot total é soma das parcelas'
);

select ok(
  exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='catalogo_confirmar_cobranca_fatura'
      and pg_get_functiondef(p.oid) like '%fatura_paga%'
  ),
  'pagamento de fatura contém liquidação financeira'
);

select ok(
  exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='catalogo_confirmar_pedido_offline'
      and pg_get_functiondef(p.oid) like '%Pedidos com entrega devem ser concluídos pelo fluxo autenticado de entrega.%'
  ),
  'fluxo legado não conclui entrega V2 pelo token do cliente'
);

select ok(
  not exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('catalogo_motoboy_acao_v2','catalogo_operacao_admin_v2')
      and pg_get_functiondef(p.oid) ~* '10[.,]00|>= *1000|< *1000'
  ),
  'nenhum piso de R$10 foi codificado nos fluxos de saque/repasse existentes'
);

select ok(
  exists(
    select 1
    from pg_constraint
    where conrelid='public.catalogo_pedidos'::regclass
      and conname='catalogo_pedidos_taxas_v2_check'
      and pg_get_constraintdef(oid) like '%versao_financeira = 2%'
  ),
  'a regra de taxas diferencia V2 dos pedidos legados'
);

select results_eq(
  $sql$select (catalogo_fluxo_precificar('entrega',101,NULL)->>'taxa_total_centavos')::integer$sql$,
  $$values (7)$$,
  'arredondamento em valores pequenos conserva 7 centavos'
);

select results_eq(
  $sql$select (catalogo_fluxo_precificar('retirada',10000,NULL)->>'taxa_motoboy_centavos')::integer$sql$,
  $$values (0)$$,
  'retirada nao reserva pagamento para motoboy'
);

select results_eq(
  $sql$select (catalogo_fluxo_precificar('consumo_local',10000,NULL)->>'taxa_plataforma_centavos')::integer$sql$,
  $$values (700)$$,
  'consumo local entrega integralmente 7% para a plataforma'
);

select results_eq(
  $sql$select (catalogo_fluxo_precificar('entrega',0,NULL)->>'http_status')::integer$sql$,
  $$values (400)$$,
  'subtotal zero e rejeitado antes de criar cobranca'
);

select ok(
  not has_function_privilege('anon',
    'public.catalogo_aplicar_pagamento_v2(uuid,text,integer,integer,text)', 'EXECUTE'),
  'anon nao pode aprovar pagamentos diretamente'
);

select ok(
  not has_function_privilege('authenticated',
    'public.catalogo_confirmar_cobranca_fatura(text,text,text,integer,text)', 'EXECUTE'),
  'usuario comum nao pode quitar faturas diretamente'
);

select ok(
  not has_function_privilege('anon',
    'public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text)', 'EXECUTE'),
  'anon nao pode confirmar entrega diretamente'
);

select ok(
  not has_function_privilege('authenticated',
    'public.catalogo_motoboy_acao_v2(uuid,text,uuid,boolean,text,text,text)', 'EXECUTE'),
  'usuario autenticado nao pode assumir identidade de motoboy por RPC direta'
);

select ok(
  not exists (
    select 1
    from generate_series(1,10000) as x(subtotal)
    where (catalogo_fluxo_precificar('entrega',x.subtotal,NULL)->>'taxa_total_centavos')::integer
      <> round(x.subtotal::numeric * 0.07)::integer
  ),
  'entrega aplica 7% exatos com arredondamento unico de 1 centavo a 100 reais'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.catalogo_comissoes_offline'::regclass
      and conname='catalogo_comissoes_offline_v2_snapshot_check'
      and pg_get_constraintdef(oid) like '%0.07%'
      and pg_get_constraintdef(oid) like '%0.05%'
  ),
  'comissoes offline aceitam arredondamento novo e snapshots historicos'
);

select * from finish();

rollback;
