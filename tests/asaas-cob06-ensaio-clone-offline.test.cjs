"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const p="scripts/validacao-pagamentos/asaas-cob06-ensaio-clone-offline.ps1";
const script=fs.readFileSync(p,"utf8");
test("COB-06: ensaio local limitado ao clone offline conhecido, nunca PROD/STAGING",()=>{
 for(const v of [
 "guia-postgres-offline-20261014","guia_pg_clone_offline_20261014",
 "public.ecr.aws/supabase/postgres:17.11.0.002",
 "HostConfig.NetworkMode -ne 'none'",
 "D:\\GuiaAndrelandiaRestauracaoLocal\\cob06-ensaio-offline",
 "auth-storage-20261014"
 ])assert.ok(script.includes(v),v);
 assert.doesNotMatch(script,/supabase\s+(?:db\s+(?:push|reset)|functions\s+deploy)/i);
 assert.doesNotMatch(script,/ASAAS_API_KEY|GITHUB_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN/);
});
test("COB-06: SQL obedece commit fixo e fontes seletivas exclusivamente de cobranca",()=>{
 assert.ok(script.includes("8b07f9b756473b59c5aa5bbef944525706db50de"));
 assert.match(script,/raw\.githubusercontent\.com/);
 for(const filename of [
 "01_asaas_cobrancas_inbox_sem_saques.sql",
 "02_termos_encerramento_sem_saques.sql",
 "20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql",
 "20261009163000_impedir_reabertura_encerramento.sql",
 "20261009180000_status_publicacao_publica_restrita.sql",
 "20261009183000_proteger_republicacao_legada_apos_encerramento.sql",
 "20261009184000_bloquear_despublicacao_legada_qualquer_status.sql",
 "20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql",
 "20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql"
 ])assert.ok(script.includes(filename),filename);
 assert.match(script,/for\(\$i=0; \$i -lt \$fontes\.Count; \$i\+\+\)/);
});
test("COB-06: candidato aplica tudo em uma transacao e SEM COMMIT efetivo",()=>{
 assert.match(script,/BEGIN;[\s\S]*SET LOCAL statement_timeout/);
 assert.match(script,/\$esperado = if\(\$i -lt 7\)\{1\}else\{0\}/);
 assert.match(script,/BEGIN\|COMMIT/);
 assert.ok(script.includes("if ($i -eq 7 -and -not $txt.TrimEnd().EndsWith(';'))"));
 assert.doesNotMatch(script,/r\?\(\$nl/);
 assert.match(script,/ROLLBACK;/);
 assert.match(script,/COB06_ROLLBACK_OK/);
 assert.match(script,/ON_ERROR_STOP=1/);
 assert.match(script,/COB06_GATES_OK/);
});
test("COB-06: auditoria exige garantias financeiras e preservacao da base",()=>{
 for(const s of [
 "catalogo_publicacao_sem_divida_guard","catalogo_historico_guard_delete",
 "catalogo_encerramento_sem_republicacao","catalogo_asaas_saques",
 "has_function_privilege('anon'","has_function_privilege('authenticated'",
 "RLS","38|3|128|29|ausente","COB06_PACOTE_SQL_CLONE_VALIDADO_COM_ROLLBACK"
 ])assert.ok(script.includes(s),s);
});
