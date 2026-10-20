"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const edge=readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const check=readFileSync("scripts/validacao-pagamentos/asaas-cob06-worker-producao-readonly.sql","utf8");
const cron=readFileSync("supabase/production-candidate/cob06_worker_webhook_producao_nao_implantar.sql","utf8");
const lock=JSON.parse(readFileSync("scripts/validacao-pagamentos/asaas-cob06-billing-only.lock.json","utf8"));
const prodURL="https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-asaas-financeiro/cron-webhooks";
const stagingRef="jbttwihctuibchhcyqtl";
const tokenName="guia_asaas_webhook_worker_token_prod_v1";
const urlName="guia_asaas_webhook_worker_url_prod_v1";

test("COB06: cobrancas produtivas dependem de worker ativo, chave e token dedicado",()=>{
 const begin=edge.indexOf('function enabled(kind:"billing"|"payouts"){');
 const end=edge.indexOf('function check(',begin);
 assert.ok(begin>0&&end>begin);
 const gate=edge.slice(begin,end);
 assert.match(gate,/ENVIRONMENT==="production" && kind==="billing"/);
 assert.match(gate,/!PRODUCTION_BILLING_APPROVED/);
 assert.match(gate,/!WEBHOOK_WORKER_ON/);
 assert.match(gate,/WEBHOOK_WORKER_TOKEN.length<48/);
 assert.match(gate,/WEBHOOK_TOKEN.length<32/);
});

test("COB06: leitura de readiness nao executa cron, DML, HTTP ou le segredos",()=>{
 const body=check
  .replace(/\$worker_esperado\$[\s\S]*?\$worker_esperado\$/g,"''")
  .replace(/--[^\n]*/g,"").replace(/'(?:[^']|'')*'/g,"''");
 assert.doesNotMatch(body,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/i);
 assert.doesNotMatch(body,/\bcron\.schedule|net\.http_post|decrypted_secret\b/i);
 assert.match(check,/COUNT|count\(\*\)/);
 assert.match(check,/infra_pronta/);
 for(const expected of [urlName,tokenName,"cron.job","vault.secrets",
    "pg_cron","pg_net","catalogo_asaas_webhook_claim","catalogo_asaas_webhook_finalizar"])
  assert.ok(check.includes(expected),expected);
});

test("COB06: worker candidato PROD nao replica URL ou segredo STAGING",()=>{
 assert.ok(cron.includes(prodURL));
 assert.ok(cron.includes("NAO EXECUTAR"));
 assert.ok(!cron.includes(stagingRef));
 assert.match(cron,/SELECT cron\.schedule\(/);
 assert.match(cron,/SELECT net\.http_post\(/);
 assert.match(cron,/WHERE url\s*=/);
 assert.match(cron,/length\(token\)>=48/);
 assert.match(cron,/x-guia-asaas-worker-token/);
 assert.match(cron,/timeout_milliseconds := 12000/);
 assert.match(cron,/WHERE jobname='guia-asaas-reconciliar-webhook'/);
 assert.match(cron,/RAISE EXCEPTION 'COB06_WORKER_PROD: agendamento existente/);
 assert.match(cron,/RAISE EXCEPTION[\s\S]*?registros Vault ausentes/);
 assert.doesNotMatch(cron,/\bASAAS_API_KEY\b|\bASAAS_WEBHOOK_TOKEN\b|\bSUPABASE_SERVICE_ROLE_KEY\b/);
 assert.doesNotMatch(cron,/\/transfers|\/payments\/[^']*\/receive/);
 assert.ok(cron.indexOf("$preflight_prod_worker$;") < cron.indexOf("SELECT cron.schedule("));
 for(const name of [urlName,tokenName])assert.ok(cron.includes(name));
});

test("COB06: cron candidato nao entra automaticamente no pacote SQL de 9 arquivos",()=>{
 assert.equal(lock.status,"candidate-never-auto-deploy");
 assert.equal(lock.files.length,9);
 assert.ok(!lock.files.some(x=>x.path.includes("worker_webhook_producao")));
 assert.ok(!lock.files.some(x=>x.path.includes("cron_worker")));
});

test("COB06: readiness do Cron exige igualdade integral com comando autorizado",()=>{
 const origem=cron.match(/\$worker_prod\$([\s\S]*?)\$worker_prod\$/);
 const preflight=check.match(/\$worker_esperado\$([\s\S]*?)\$worker_esperado\$/);
 assert.ok(origem&&preflight,"comandos SQL completos presentes");
 assert.equal(origem[1].trim(),preflight[1].trim(),
  "fonte e preflight nao podem divergir nem por um detalhe do worker");
 assert.match(check,/pg_catalog\.btrim\(command\)=pg_catalog\.btrim\(\$worker_esperado\$/);
 assert.match(check,/j\.cadastrados=1 AND j\.comandos_aprovados=1/);
 assert.match(check,/AND worker_cron_pronto AND worker_comando_aprovado/);
 assert.ok(!preflight[1].includes("ASAAS_API_KEY"));
 const alterado=origem[1].replace("timeout_milliseconds := 12000",
  "timeout_milliseconds := 18000");
 assert.notEqual(alterado.trim(),preflight[1].trim(),
  "mudanca de operacao deve reprovar o comando, ainda que o job tenha o nome certo");
 const troca=origem[1].replace("x-guia-asaas-worker-token",
  "x-guia-token-outro");
 assert.notEqual(troca.trim(),preflight[1].trim(),
  "trocar header de autenticacao nao pode passar na auditoria");
});
