-- COB-06: assinatura SOMENTE LEITURA das tabelas financeiras existentes.
-- Compara catalogos, publicacoes, pedidos, comissoes, fechamentos e cobrancas.
-- Apenas metadados de esquema (pg_catalog); nunca consulta registros de pessoas/lojas.
WITH tabelas(nome) AS (
 VALUES ('catalogos'),('comercios_publicados'),('catalogo_pedidos'),
        ('catalogo_comissoes_offline'),('catalogo_fechamentos_offline'),
        ('catalogo_fatura_cobrancas')
), colunas AS (
 SELECT t.nome,
  string_agg(
    a.attnum::text || ':' || a.attname || ':' ||
    pg_catalog.format_type(a.atttypid,a.atttypmod) || ':' ||
    a.attnotnull::text || ':' ||
    coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),''),
    '||' ORDER BY a.attnum
  ) AS texto, count(a.attnum) AS total
 FROM tabelas t
 LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',t.nome))
 LEFT JOIN pg_catalog.pg_attribute a
   ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 GROUP BY t.nome
), checks AS (
 SELECT t.nome,string_agg(
   co.conname || ':' || pg_catalog.pg_get_constraintdef(co.oid,true),
   '||' ORDER BY co.conname
 ) AS texto,count(co.oid) AS total
 FROM tabelas t
 LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',t.nome))
 LEFT JOIN pg_catalog.pg_constraint co ON co.conrelid=c.oid
 GROUP BY t.nome
), gatilhos AS (
 SELECT t.nome,string_agg(
   tr.tgname || ':' || pg_catalog.pg_get_triggerdef(tr.oid,true) || ':' || tr.tgenabled::text,
   '||' ORDER BY tr.tgname
 ) AS texto,count(tr.oid) AS total
 FROM tabelas t
 LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(pg_catalog.format('public.%I',t.nome))
 LEFT JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=c.oid AND NOT tr.tgisinternal
 GROUP BY t.nome
)
SELECT t.nome,pg_catalog.md5(
  coalesce(a.texto,'') || '###' || coalesce(c.texto,'') || '###' || coalesce(g.texto,'')
) AS fingerprint, a.total::integer AS colunas, c.total::integer AS constraints, g.total::integer AS gatilhos
FROM tabelas t
JOIN colunas a USING(nome)
JOIN checks c USING(nome)
JOIN gatilhos g USING(nome)
ORDER BY t.nome;
