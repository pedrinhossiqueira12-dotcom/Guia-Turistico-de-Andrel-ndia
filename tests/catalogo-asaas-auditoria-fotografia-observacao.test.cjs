"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009235930_fotografia_creditos_evidencia_bancaria.sql");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
test("evidência captura hash e contagem local sem aceitar dados enviados ao banco",()=>{
 assert.match(sql,/ALTER TABLE public\.catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS creditos_fingerprint_observado_sha256/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS creditos_observados bigint/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS valor_creditos_observados_centavos bigint/);
 assert.match(sql,/v_fotografia:=public\.catalogo_asaas_preconferir_pagamento_excepcional\(/);
 assert.match(sql,/NEW\.creditos_fingerprint_observado_sha256:=/);
 assert.match(sql,/NEW\.creditos_observados:=/);
 assert.match(sql,/NEW\.valor_creditos_observados_centavos:=/);
 assert.match(sql,/NEW\.fotografia_observada_em:=pg_catalog\.now\(\)/);
});
test("fotografia falha fechada, sem impedir que observacao de pagamento seja auditada",()=>{
 assert.match(sql,/EXCEPTION WHEN OTHERS THEN\s+v_fotografia:=NULL/);
 assert.match(sql,/NEW\.composicao_conferida_na_observacao:=coalesce/);
 assert.match(sql,/NEW\.valor_creditos_observados_centavos=NEW\.valor_centavos/);
 assert.match(sql,/NEW\.creditos_fingerprint_observado_sha256 IS NOT NULL/);
 assert.match(sql,/hashtextextended\('asaas-saque:'\|\|NEW\.motoboy_id::text,0\)/);
 assert.match(sql,/v_motoboy IS DISTINCT FROM NEW\.motoboy_id/);
 assert.match(sql,/v_valor IS DISTINCT FROM NEW\.valor_centavos/);
 assert.doesNotMatch(sql,/UPDATE public\.catalogo_remuneracoes_v2|INSERT INTO public\.catalogo_repasses_v2|POST \/transfers/);
});
test("ensaio de R$120 confirma fotografia em evidencia DONE, com hold depois",()=>{
 assert.match(ci,/DO \$orphan_large_balance\$/);
 assert.match(ci,/SELECT public\.catalogo_asaas_registrar_observacao_excepcional\(/);
 assert.match(ci,/v_bank_count<>2 OR v_bank_amount<>12000/);
 assert.match(ci,/v_bank_fingerprint IS DISTINCT FROM v_preflight->>'fingerprint_creditos_sha256'/);
 assert.match(ci,/v_after_bank->>'evidencias_bancarias_para_conciliar' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_after_bank->>'pagamento_autorizado' IS DISTINCT FROM 'false'/);
});
