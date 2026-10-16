const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync('pages/asaas-homologacao-sandbox.html','utf8');
const block=src.slice(src.indexOf('// COB-06: unica solicitacao elegivel.'),src.indexOf('async function deliveryApi('));

test('botao COB06 usa pedido preexistente fixo e nunca cria outro pedido',()=>{
 assert.match(src,/id="qa-cob06-request"/);
 assert.match(src,/id="qa-cob06" hidden/);
 assert.match(block,/COB06_QA_CANCEL_PEDIDO = "a4ca7c4e-465f-4342-ae18-5c7eea1dec15"/);
 assert.match(block,/qaApi\("catalogo-pedidos-offline-admin"/);
 assert.match(block,/acao:"atualizar_status",pedido_id:COB06_QA_CANCEL_PEDIDO,status:"cancelado"/);
 assert.doesNotMatch(block,/criar_pedido_offline|gerar_fechamento|criar_cobranca|confirmar_entrega/);
});
test('botao COB06 verifica conta proprietaria de STAGING e confirma natureza ficticia',()=>{
 assert.match(block,/client\.auth\.getUser\(\)/);
 assert.match(block,/pedrinhossiqueira@gmail\.com/);
 assert.match(block,/window\.confirm/);
 assert.match(block,/sem entrega de produto ou recebimento de dinheiro/);
 assert.match(block,/cob06PedidoSolicitado=true/);
 assert.match(block,/cob06PedidoSolicitado\)\$\("qa-cob06-request"\)\.disabled=true/);
});

const admin=src.slice(src.indexOf('// COB-06 revisao final:'),src.indexOf('async function deliveryApi('));

test('revisor COB06 usa conta real e ocorrencia aberta unica, com duas confirmacoes',()=>{
 assert.match(src,/id="qa-cob06-review" hidden/);
 assert.match(src,/id="qa-cob06-review-submit"/);
 assert.match(src,/qa-cob06-review"\)\.hidden=!u\|\|u\.email\?\.toLowerCase\(\)!=="pedrinhossiqueira12@gmail.com"/);
 assert.match(admin,/COB06_QA_REVISOR = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a"/);
 assert.match(admin,/COB06_QA_OCORRENCIA = "b8bc453b-810b-4e6a-af6d-b82c59b1db20"/);
 assert.match(admin,/data\?\.user\?\.id!==COB06_QA_REVISOR/);
 assert.equal((admin.match(/window\.confirm\(/g)||[]).length,2);
});
test('revisao COB06 exige API exclusiva, atestados completos e nao executa cobranca',()=>{
 assert.match(admin,/qaApi\("catalogo-cob06-qa"/);
 for(const needle of ['acao:"cancelar_retirada_ficticia_qa"','pedido_id:COB06_QA_CANCEL_PEDIDO','ocorrencia_id:COB06_QA_OCORRENCIA','decisao:"cancelamento_legitimo"','sem_recebimento_confirmado:true','sem_entrega_confirmada:true','cob06Revisado=true'])
   assert.ok(admin.includes(needle),needle);
 assert.doesNotMatch(admin,/criar_pedido_offline|gerar_fechamento|criar_cobranca|solicitar_saque|confirmar_entrega/);
 assert.match(admin,/cob06Revisado\)\$\("qa-cob06-review-submit"\)\.disabled=true/);
});
