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

test("somente admin recebe comparação forense com foto existente, sem baixar saldos",()=>{
 const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
 const ui=read("js/admin-encerramentos.js");
 const start=edge.indexOf("async function preconferirExcepcionalAdmin(");
 const end=edge.indexOf("async function consultarERegistrarTransferenciaExcepcionalSandbox(",start);
 assert.ok(start>=0&&end>start);
 const h=edge.slice(start,end);
 assert.match(h,/uid!==ADMIN_USER_ID/);
 assert.match(h,/catalogo_asaas_preconferir_pagamento_excepcional/);
 assert.match(h,/catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(h,/\.eq\("tipo",tipo\)\.eq\("solicitacao_id",id\)\.maybeSingle\(\)/);
 assert.match(h,/fingerprint_igual_ao_atual:igual/);
 assert.match(h,/foto\.creditos_fingerprint_observado_sha256===resultado\.fingerprint_creditos_sha256/);
 assert.match(ui,/foto\.fingerprint_igual_ao_atual===true/);
 assert.match(ui,/DIVERGENTE OU AUSENTE/);
 assert.match(ui,/c\.pagamento_autorizado!==false/);
 assert.doesNotMatch(h,/POST \/transfers|UPDATE public\.catalogo_remuneracoes/);
});
