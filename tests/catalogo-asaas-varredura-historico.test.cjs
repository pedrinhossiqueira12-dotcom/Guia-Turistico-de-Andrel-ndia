"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const admin=fs.readFileSync("js/admin-encerramentos.js","utf8");
const start=edge.indexOf("async function auditarHistoricoTransferenciasExcepcionaisSandboxAdmin(");
const end=edge.indexOf("// Dossie administrativo append-only.",start);
const scanner=edge.slice(start,end);

test("varredura somente admin e Sandbox, com ID de reserva UUID",()=>{
 assert.ok(start>=0&&end>start);
 assert.match(scanner,/uid!==ADMIN_USER_ID/);
 assert.match(scanner,/ENVIRONMENT!=="sandbox"/);
 assert.match(scanner,/!ASAAS_TOKEN/);
 assert.match(scanner,/separacao_id/);
 assert.match(scanner,/situa[cç][aã]o/);
 assert.match(scanner,/reserva\.situacao!=="congelada"/);
});

test("usa apenas listagem GET paginada com limite, nunca um POST de transferencia",()=>{
 assert.match(scanner,/const LIMIT=100,MAX_PAGINAS=12/);
 assert.match(scanner,/for\(let page=0;page<MAX_PAGINAS;page\+\+\)/);
 assert.match(scanner,/await asaas\("\/transfers\?limit="\+LIMIT\+"&offset="\+offset\)/);
 assert.match(scanner,/typeof result\.hasMore!=="boolean"/);
 assert.match(scanner,/result\.data\.length>LIMIT/);
 assert.match(scanner,/if\(result\.hasMore===false\)\{completa=true;break;\}/);
 assert.match(scanner,/result\.data\.length===0/);
 assert.doesNotMatch(scanner,/\bPOST\b|method="POST"|method:"POST"|await rpc\(/);
 assert.doesNotMatch(scanner,/\.insert\(|\.update\(|\.delete\(/);
});

test("confronta referencia, ID, valor, status e conflitos com saques comuns",()=>{
 for(const item of [
  "guia-exc:", "catalogo_asaas_separacoes_excepcionais",
  "catalogo_asaas_transferencias_excepcionais_auditoria",
  "catalogo_asaas_saques", "referenciasDistintas>1",
  "vinculoLocalDivergente", "vinculoNaoLocalizado",
  "tRef===referencia", "tId===idVinculado",
  "refsDeOutroId", "valoresDivergentes", "formatosAmbiguos",
  "idsSemReferencia", "listaRepetida", "estadosDone",
 ])assert.ok(scanner.includes(item),item);
 assert.match(scanner,/const vistos=new Set<string>\(\)/);
 assert.match(scanner,/if\(vinculoError\)/);
 assert.match(scanner,/if\(saqueError\)/);
});

test("nunca alega ausencia de Pix, prova original do destinatario ou autoriza baixa",()=>{
 for(const flag of [
  "historico_bancario_independente_comprovado:false",
  "ausencia_de_pix_anterior_comprovada:false",
  "destinatario_original_confirmado:false",
  "liberacao_autorizada:false",
  "pagamento_autorizado:false",
  "baixa_realizada:false",
  "movimenta_dinheiro:false",
 ])assert.ok(scanner.includes(flag),flag);
 assert.match(scanner,/AMOSTRA INCOMPLETA|amostra incompleta/i);
 assert.match(scanner,/referencia_ja_encontrada_no_banco:referencias>0/);
 assert.doesNotMatch(scanner,/pixAddressKey|cpfCnpj|chave_pix_enc|bankAccount/);
 assert.doesNotMatch(scanner,/console\.log\(|JSON\.stringify\(result\)/);
});

test("painel comunica limite e HOLD sem exibir identificadores de terceiros",()=>{
 assert.match(edge,/case "auditar_historico_transferencias_excepcionais_sandbox_admin":return await auditarHistoricoTransferenciasExcepcionaisSandboxAdmin\(user\.id,body\)/);
 assert.match(admin,/Verificar transferências repetidas \(Sandbox\)/);
 assert.match(admin,/acao:"auditar_historico_transferencias_excepcionais_sandbox_admin"/);
 assert.match(admin,/HOLD OBRIGATÓRIO/);
 assert.match(admin,/a\.ausencia_de_pix_anterior_comprovada!==false/);
 assert.match(admin,/a\.destinatario_original_confirmado!==false/);
 assert.match(admin,/AMOSTRA INCOMPLETA/);
 assert.match(admin,/Nenhuma ausência de Pix foi comprovada/);
});
