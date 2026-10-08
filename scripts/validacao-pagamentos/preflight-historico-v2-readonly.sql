-- Auditoria somente leitura do histórico financeiro.
-- Executar após snapshot/backup, antes de qualquer migration financeira.
-- Sem escrita, sem funções SECURITY DEFINER e sem exposição de dados pessoais.
-- O campo incompatibilidades_nova_constraint deve ser 0 nas duas linhas.
-- Os campos v2_total_historico_divergente são informativos:
-- snapshots antigos válidos NÃO podem ser reescritos retroativamente.
WITH pedidos AS (
  SELECT
    versao_financeira,
    taxa_total_centavos,
    round(subtotal_produtos_centavos::numeric * 0.07)::integer AS total_v2,
    (
      taxa_plataforma_centavos >= 0
      AND taxa_motoboy_centavos >= 0
      AND taxa_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
      AND (
        (versao_financeira = 1
          AND taxa_motoboy_centavos = 0
          AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer)
        OR
        (versao_financeira = 2 AND (
          (modalidade <> 'entrega'
            AND taxa_motoboy_centavos = 0
            AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.07)::integer)
          OR
          (modalidade = 'entrega'
            AND taxa_motoboy_centavos = round(subtotal_produtos_centavos::numeric * 0.02)::integer
            AND taxa_plataforma_centavos IN (
              round(subtotal_produtos_centavos::numeric * 0.05)::integer,
              round(subtotal_produtos_centavos::numeric * 0.07)::integer - taxa_motoboy_centavos
            ))
        ))
      )
    ) AS compativel
  FROM public.catalogo_pedidos
),
comissoes AS (
  SELECT
    versao_financeira,
    valor_total_centavos,
    round(subtotal_produtos_centavos::numeric * 0.07)::integer AS total_v2,
    (
      versao_financeira IN (1,2)
      AND taxa_plataforma_centavos >= 0
      AND taxa_motoboy_centavos >= 0
      AND valor_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
      AND valor_comissao_centavos = valor_total_centavos
      AND (
        (versao_financeira = 1
          AND taxa_motoboy_centavos = 0
          AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer)
        OR
        (versao_financeira = 2 AND (
          (modalidade <> 'entrega'
            AND taxa_motoboy_centavos = 0
            AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.07)::integer)
          OR
          (modalidade = 'entrega'
            AND taxa_motoboy_centavos = round(subtotal_produtos_centavos::numeric * 0.02)::integer
            AND taxa_plataforma_centavos IN (
              round(subtotal_produtos_centavos::numeric * 0.05)::integer,
              round(subtotal_produtos_centavos::numeric * 0.07)::integer - taxa_motoboy_centavos
            ))
        ))
      )
    ) AS compativel
  FROM public.catalogo_comissoes_offline
)
SELECT
  'pedidos'::text AS area,
  COUNT(*)::integer AS registros,
  COUNT(*) FILTER (WHERE versao_financeira = 1)::integer AS historico_v1,
  COUNT(*) FILTER (WHERE versao_financeira = 2)::integer AS historico_v2,
  COUNT(*) FILTER (WHERE compativel IS NOT TRUE)::integer AS incompatibilidades_nova_constraint,
  COUNT(*) FILTER (WHERE versao_financeira = 2 AND taxa_total_centavos IS DISTINCT FROM total_v2)::integer AS v2_total_historico_divergente
FROM pedidos
UNION ALL
SELECT
  'comissoes'::text,
  COUNT(*)::integer,
  COUNT(*) FILTER (WHERE versao_financeira = 1)::integer,
  COUNT(*) FILTER (WHERE versao_financeira = 2)::integer,
  COUNT(*) FILTER (WHERE compativel IS NOT TRUE)::integer,
  COUNT(*) FILTER (WHERE versao_financeira = 2 AND valor_total_centavos IS DISTINCT FROM total_v2)::integer
FROM comissoes;
