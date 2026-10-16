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
