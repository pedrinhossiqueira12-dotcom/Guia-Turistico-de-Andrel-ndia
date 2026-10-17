"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const admin=fs.readFileSync("js/admin-encerramentos.js","utf8");
const start=edge.indexOf("async function auditarHistoricoTransferenciasExcepcionaisSandboxAdmin(");
const end=edge.indexOf("// Dossie administrativo append-only.",start);
const scanner=edge.slice(start,end);

test("GET paginado Asaas restringe bytes, media type, UTF-8 e JSON sem abrir pagamentos",()=>{
 assert.match(edge,/const MAX_ASAAS_LISTAGEM_BYTES=2\*1024\*1024/);
 assert.match(edge,/response\.headers\.get\("content-length"\)/);
 assert.match(edge,/response\.headers\.get\("content-type"\)/);
 assert.match(edge,/reader\.read\(\)/);
 assert.match(edge,/if\(size>MAX_ASAAS_LISTAGEM_BYTES\)/);
 assert.match(edge,/new TextDecoder\("utf-8",\{fatal:true\}\)/);
 assert.match(edge,/method==="GET"&&path\.startsWith\("\/transfers\?"\)/);
 assert.match(edge,/await lerListagemAsaasLimitada\(response\)/);
 assert.match(edge,/Auditoria inconclusiva\. HOLD\./);
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.match(edgeTests,/varredura rejeita resposta Asaas enorme ou malformada sem expor dados/);
 assert.match(edgeTests,/content-length acima do limite/);
 assert.match(edgeTests,/resposta sem MIME JSON/);
 assert.match(edgeTests,/corpo real supera limite/);
 assert.match(edgeTests,/UTF-8 invalido/);
 assert.match(edgeTests,/JSON truncado/);
});

test("varredura somente admin e Sandbox, com ID de reserva UUID",()=>{
 assert.ok(start>=0&&end>start);
 assert.match(scanner,/uid!==ADMIN_USER_ID/);
 assert.match(scanner,/ENVIRONMENT!=="sandbox"/);
 assert.match(scanner,/!ASAAS_TOKEN/);
 assert.match(scanner,/separacao_id/);
 assert.match(scanner,/situa[cç][aã]o/);
 assert.match(scanner,/reserva\.situacao!=="congelada"/);
});

test("valida a integridade da reserva congelada ANTES de qualquer consulta bancaria",()=>{
 const orderIdCheck=scanner.indexOf("reserva.id!==id");
 const orderLinkLookup=scanner.indexOf('db.from(\n  "catalogo_asaas_transferencias_excepcionais_auditoria")');
 const orderBankLookup=scanner.indexOf('await asaas("/transfers?limit="');
 assert.ok(orderIdCheck>=0&&orderLinkLookup>orderIdCheck&&orderBankLookup>orderLinkLookup);
 for(const expected of [
  'reserva.tipo!=="residual"&&reserva.tipo!=="saida"',
  '!uuidValido.test(reserva.solicitacao_id)',
  '!uuidValido.test(reserva.motoboy_id)',
  'typeof reserva.valor_centavos!=="number"',
  '!Number.isSafeInteger(reserva.valor_centavos)',
  'reserva.valor_centavos<=0',
  'Separação financeira inconsistente; auditoria inconclusiva. HOLD.',
 ])assert.ok(scanner.includes(expected),expected);
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.ok(edgeTests.includes("varredura bloqueia separacao congelada inconsistente antes de consultar banco"));
 assert.ok(edgeTests.includes("requisicoesBanco===0&&requisicoesVinculo===0"));
});

test("vinculo bancario local precisa ter ID e tipos validos antes do GET Asaas",()=>{
 const orderGuard=scanner.indexOf("if(vinculo!==null&&vinculo!==undefined)");
 const orderBank=scanner.indexOf('await asaas("/transfers?limit="');
 assert.ok(orderGuard>=0&&orderBank>orderGuard);
 for(const expected of [
  'typeof vinculo.transferencia_id!=="string"',
  'vinculo.transferencia_id.length<1',
  'vinculo.transferencia_id.length>180',
  '/\\s/.test(vinculo.transferencia_id)',
  'typeof vinculo.referencia_externa!=="string"',
  'vinculo.referencia_externa.trim()!==vinculo.referencia_externa',
  'typeof vinculo.valor_centavos!=="number"',
  '!Number.isSafeInteger(vinculo.valor_centavos)',
  'vinculo.valor_centavos<=0',
  '!uuidValido.test(vinculo.motoboy_id)',
  'Vínculo bancário local inconsistente; auditoria inconclusiva. HOLD.',
  'vinculo?.valor_centavos!==reserva.valor_centavos',
 ])assert.ok(scanner.includes(expected),expected);
 assert.doesNotMatch(scanner,/Number\(vinculo\?\.valor_centavos\)/);
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.ok(edgeTests.includes("varredura bloqueia vinculo bancario local malformado antes de GET Asaas"));
 assert.ok(edgeTests.includes("bancoGets===0&&saquesGets===0"));
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

test("recusa paginacao curta e metadados incompletos do Asaas",()=>{
 assert.match(scanner,/typeof result\.limit!=="number"/);
 assert.match(scanner,/Number\.isSafeInteger\(result\.limit\)/);
 assert.match(scanner,/result\.limit!==LIMIT/);
 assert.match(scanner,/typeof result\.offset!=="number"/);
 assert.match(scanner,/result\.offset!==offset/);
 assert.match(scanner,/typeof result\.totalCount!=="number"/);
 assert.match(scanner,/Number\.isSafeInteger\(result\.totalCount\)/);
 assert.match(scanner,/result\.hasMore===true&&result\.data\.length!==LIMIT/);
 assert.match(scanner,/result\.hasMore===true&&result\.totalCount<=offset\+result\.data\.length/);
 assert.match(scanner,/result\.hasMore===false&&result\.totalCount!==offset\+result\.data\.length/);
 assert.match(scanner,/Paginação bancária inválida: histórico inconclusivo\. HOLD\./);
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.match(edgeTests,/varredura recusa paginas Asaas parciais/);
 assert.match(edgeTests,/pagina parcial com hasMore=true/);
 assert.match(edgeTests,/limite reduzido pelo provedor/);
 assert.match(edgeTests,/totalCount menor que dados/);
 assert.match(edgeTests,/hasMore falso mas totalCount aponta mais registros/);
 assert.match(edgeTests,/hasMore verdadeiro apesar de totalCount completo/);
 assert.match(scanner,/let totalInicial:number\|null=null/);
 assert.match(scanner,/if\(totalInicial===null\)totalInicial=result\.totalCount/);
 assert.match(scanner,/result\.totalCount!==totalInicial/);
 assert.match(scanner,/Histórico Asaas mudou entre páginas: auditoria inconclusiva\. HOLD\./);
 assert.match(edgeTests,/varredura falha fechada se totalCount muda entre duas paginas/);
 assert.match(edgeTests,/varredura em duas paginas detecta ID de transferencia repetido/);
 assert.match(edgeTests,/ids_repetidos_na_listagem===1/);
 assert.match(edgeTests,/ausencia_de_pix_anterior_comprovada===false/);
});

test("confronta referencia, ID, valor, status e conflitos com saques comuns",()=>{
 for(const item of [
  "guia-exc:", "catalogo_asaas_separacoes_excepcionais",
  "catalogo_asaas_transferencias_excepcionais_auditoria",
  "catalogo_asaas_saques", "referenciasDistintas>1",
  "idsDaReferenciaTambemEmSaqueComum>0",
  "idsDaReferenciaComOutraReferencia>0",
  "primeiraReferenciaPorId", "idsComReferenciaDivergente",
  "vinculoLocalDivergente", "vinculoNaoLocalizado",
  "tRef===referencia", "tId===idVinculado",
  "refsDeOutroId", "valoresDivergentes", "formatosAmbiguos",
  "idsSemReferencia", "listaRepetida", "idsRepetidosGlobalmente",
  "idsRepetidosGlobais>0", "idsSemIdentificadorGlobais>0", "estadosDone",
 ])assert.ok(scanner.includes(item),item);
 assert.match(scanner,/const vistos=new Set<string>\(\)/);
 assert.match(scanner,/if\(vinculoError\)/);
 assert.match(scanner,/if\(saqueError\)/);
 assert.match(scanner,/const MAX_IDS_CONFERENCIA=400,LOTE_IDS_CONFERENCIA=40/);
 assert.match(scanner,/vistos\.size>MAX_IDS_CONFERENCIA/);
 assert.match(scanner,/\.in\("transferencia_id",lote\)/);
 assert.match(scanner,/if\(saquesError\|\|!Array\.isArray\(saques\)\)/);
 assert.match(scanner,/ids_da_referencia_tambem_em_saques_comuns:idsDaReferenciaTambemEmSaqueComum/);
 assert.match(scanner,/ids_da_referencia_com_outra_referencia:idsDaReferenciaComOutraReferencia/);
 assert.match(scanner,/ids_repetidos_globais:idsRepetidosGlobais/);
 assert.match(scanner,/ids_sem_identificador_globais:idsSemIdentificadorGlobais/);
 assert.match(admin,/ids_sem_identificador_globais/);
 assert.ok(scanner.includes("if(!tId)idsSemIdentificadorGlobais++"));
 assert.ok(scanner.includes("idsRepetidosGlobalmente.add(tId)"));
 assert.match(admin,/ids_repetidos_globais/);
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.match(edgeTests,/varredura detecta transferência de saque comum sem vínculo excepcional prévio/);
 assert.match(edgeTests,/ids_da_referencia_tambem_em_saques_comuns===1/);
 assert.match(admin,/ids_da_referencia_tambem_em_saques_comuns/);
});

test("valor observado nao arredonda diferencas fracionarias de centavo",()=>{
 assert.ok(scanner.includes('const centsBrutos=valorBanco*100;'));
 assert.ok(scanner.includes('Math.abs(centsBrutos-centsInteiros)>1e-7'));
 assert.ok(scanner.includes('!Number.isSafeInteger(centsInteiros)'));
 assert.ok(scanner.includes('centsInteiros!==Number(reserva.valor_centavos)'));
 const edgeTests=fs.readFileSync("supabase/functions/tests/catalogo-edge-http.test.ts","utf8");
 assert.match(edgeTests,/varredura rejeita fracoes de centavo sem arredondar o valor bancario/);
 assert.match(edgeTests,/120\.004/);
 assert.match(edgeTests,/120\.006/);
 assert.match(edgeTests,/divergencias_de_valor===caso\.divergencias/);
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
