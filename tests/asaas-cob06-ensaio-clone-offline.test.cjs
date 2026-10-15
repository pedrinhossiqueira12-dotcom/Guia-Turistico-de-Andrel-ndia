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
 assert.ok(script.includes("6dd9b6259cf21ad5e6bbd46f6b50cae372dab3c8"));
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

test("COB-06: PowerShell 5.1 preserva saida de psql e distingue NOTICE de erro",()=>{
 assert.match(script,/Start-Process -FilePath \$dockerExe/);
 assert.match(script,/-Wait -PassThru -RedirectStandardOutput \$saidaNormal -RedirectStandardError \$saidaAvisos/);
 assert.match(script,/\$codigo = \$processo\.ExitCode/);
 assert.match(script,/if\(\$codigo -ne 0\)/);
 assert.match(script,/\$textoAvisos\.Contains\('COB06_GATES_OK'\)/);
 assert.match(script,/\$textoNormal\.Contains\('COB06_ROLLBACK_OK'\)/);
 assert.doesNotMatch(script,/\$saida = @\(docker exec [^\n]+ 2>&1\)/);
});

test("COB-06: escolhe somente o primeiro caminho docker.exe valido",()=>{
 assert.match(script,/\$dockerCommands = @\(Get-Command docker\.exe -CommandType Application -ErrorAction Stop\)/);
 assert.match(script,/\$dockerExe = \[string\]\$dockerCommands\[0\]\.Source/);
 assert.match(script,/Test-Path -LiteralPath \$dockerExe -PathType Leaf/);
 assert.doesNotMatch(script,/\$dockerExe = \(Get-Command docker -CommandType Application -ErrorAction Stop\)\.Source/);
});

test("COB-06: teste funcional ficticio inclui cinco guardas, quitacao e arquivamento no rollback",()=>{
 const sql=fs.readFileSync("supabase/tests/isolated/asaas-cob06-guardas-clone-restaurado-rollback.sql","utf8");
 assert.match(script,/guardas-clone-restaurado-rollback\.sql/);
 assert.match(script,/\$auditoria = \$auditoria\.Replace\(\$marco,\(\$testeSql \+ \$nl \+ \$marco\)\)/);
 assert.ok(script.includes("COB06_GUARDAS_FUNCIONAIS_OK"));
 assert.ok(script.includes("COB06_GUARDAS_FUNCIONAIS_VALIDADAS_E_REVERTIDAS"));
 for(const term of ["cob06-fixture-descartavel-20261015","catalogo_solicitar_encerramento_financeiro",
  "catalogo_finalizar_encerramento_financeiro","catalogo_status_publicacao",
  "catalogo_fechamentos_offline","COB06_GUARDAS_FUNCIONAIS_OK",
  "SQLSTATE '23514'","'deletado'","'arquivado'","v_negativas<>5"])
 assert.ok(sql.includes(term),term);
 assert.doesNotMatch(sql,/(^|\n)\s*COMMIT\s*;/mi);
 assert.doesNotMatch(sql,/pg_net|cron\.schedule|\/transfers|ASAAS_API_KEY|GITHUB_TOKEN/i);
 const candidato=fs.readFileSync(
  "supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql","utf8");
 assert.ok(candidato.includes("SET status='deletado', destaque=false"));
 assert.ok(candidato.includes("SET situacao='arquivado'"));
 assert.ok(!candidato.includes("SET status='arquivado'"));
});

test("COB-06: arquivamento sem catalogo sob autorizacao administrativa e rollback",()=>{
 const sql=fs.readFileSync("supabase/tests/isolated/asaas-cob06-guardas-clone-restaurado-rollback.sql","utf8");
 const candidata=fs.readFileSync(
  "supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql","utf8");
 for(const term of ["catalogo_arquivar_sem_catalogo_admin","COB06_SEM_CATALOGO_ADMIN_OK"]){
  assert.ok(sql.includes(term),term);
 }
 assert.ok(script.includes("COB06_SEM_CATALOGO_ADMIN_OK"));
 assert.ok(script.includes("COB06_SEM_CATALOGO_ADMIN_VALIDADO_E_REVERTIDO"));
 assert.ok(candidata.includes("CREATE OR REPLACE FUNCTION public.catalogo_arquivar_sem_catalogo_admin("));
 assert.ok(candidata.includes("SECURITY DEFINER SET search_path='' AS $sem_catalogo$"));
 assert.ok(candidata.includes("REVOKE ALL ON FUNCTION public.catalogo_arquivar_sem_catalogo_admin(text,uuid)"));
 assert.ok(candidata.includes("GRANT EXECUTE ON FUNCTION public.catalogo_arquivar_sem_catalogo_admin(text,uuid)"));
 for(const t of ["catalogo_pedidos","catalogo_comissoes_offline","catalogo_fechamentos_offline",
  "catalogo_fatura_cobrancas","catalogo_asaas_clientes","catalogo_assinaturas","catalogo_encerramentos_comercio"]){
  assert.ok(candidata.includes("FROM public."+t+" WHERE comercio_id=p_comercio"),t);
 }
});
