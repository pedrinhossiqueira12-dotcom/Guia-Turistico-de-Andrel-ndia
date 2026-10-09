"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const sql=read("supabase/pending-migrations/20261009193000_pedidos_regularizacao_motoboy_inativo.sql");
const courier=read("js/motoboy.js");
const courierHtml=read("pages/motoboy.html");
const admin=read("js/admin-encerramentos.js");
const adminHtml=read("pages/admin-encerramentos.html");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
function part(start,end) {
 const a=edge.indexOf(start),b=edge.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,"Handler ausente: "+start);
 return edge.slice(a,b);
}
const request=part("async function solicitarRegularizacaoSaida(","// Leitura financeira do pedido");
const review=part("async function revisarRegularizacaoSaidaAdmin(","async function reconcileTransfer(");
const list=part("async function listarRegularizacoesSaidaAdmin(","async function revisarRegularizacaoSaidaAdmin(");

test("pedido é autenticado e limitado a inativo com >=R$100 em saldo liberado",()=>{
 assert.match(edge,/const user=await auth\(request\)/);
 assert.match(request,/requireTerms\(uid,"motoboy","",true\)/);
 assert.match(request,/\.eq\("usuario_id",uid\)\.eq\("ativo",true\)\.limit\(1\)/);
 assert.match(request,/check\(!active\?\.length/);
 assert.match(request,/catalogo_asaas_saldo_historico/);
 assert.match(request,/amount>=SAQUE_MINIMO_CENTAVOS/);
 assert.match(request,/Number\.isSafeInteger\(amount\)/);
 assert.match(request,/saldo_snapshot_centavos:amount/);
 assert.match(request,/\.in\("status",\["pendente","em_analise"\]\)/);
 assert.match(edge,/case "solicitar_regularizacao_saida":return await solicitarRegularizacaoSaida\(user\.id,body\)/);
});

test("tabela é privada, impede conclusão artificial e duplica não",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.catalogo_asaas_regularizacoes_inativos/);
 assert.match(sql,/CHECK\(saldo_snapshot_centavos >= 10000\)/);
 assert.match(sql,/CHECK\(status IN \('pendente','em_analise','recusada'\)\)/);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS catalogo_asaas_regularizacoes_inativos_abertos_idx/);
 assert.match(sql,/WHERE status IN \('pendente','em_analise'\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.catalogo_asaas_regularizacoes_inativos/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/OLD\.status='recusada'/);
 assert.match(sql,/NEW\.saldo_snapshot_centavos IS DISTINCT FROM OLD\.saldo_snapshot_centavos/);
 assert.doesNotMatch(sql,/INSERT INTO public\.catalogo_repasses|POST \/transfers|UPDATE public\.catalogo_remuneracoes/);
});

test("admin não pode marcar como pago, nem executar Pix ou cancelar créditos",()=>{
 for(const h of [review,list])assert.match(h,/uid!==ADMIN_USER_ID/);
 assert.match(review,/\.eq\("id",id\)\.eq\("status",esperado\)/);
 assert.match(review,/destino==="recusada"\|\|\(destino==="em_analise"&&esperado==="pendente"\)/);
 assert.match(review,/justificativa\.length>=20/);
 assert.match(review,/revisado_por:destino==="recusada"\?uid:null/);
 assert.doesNotMatch(review,/concluida|\/transfers|asaas\(|catalogo_asaas_atualizar_saque|catalogo_remuneracoes_v2/);
 assert.match(edge,/case "revisar_regularizacao_saida_admin":return await revisarRegularizacaoSaidaAdmin\(user\.id,body\)/);
 assert.match(edge,/case "listar_regularizacoes_saida_admin":return await listarRegularizacoesSaidaAdmin\(user\.id\)/);
});

test("formulários e histórico mostram pedido sem prometer pagamento",()=>{
 for(const [src,id] of [[courierHtml,"motoboySaidaForm"],[courierHtml,"motoboySaidaFeedback"],[adminHtml,"listaRegularizacoesSaida"]])
   assert.ok(src.includes('id="'+id+'"'));
 assert.match(courier,/acao:"solicitar_regularizacao_saida"/);
 assert.match(courier,/carteira\.regularizacao_saida/);
 assert.match(courier,/motoboySaidaForm/);
 assert.match(admin,/acao:"listar_regularizacoes_saida_admin"/);
 assert.match(admin,/acao:"revisar_regularizacao_saida_admin"/);
 assert.match(admin,/status_esperado:String\(item\.status/);
 assert.doesNotMatch(admin,/innerHTML\s*=|concluida|chave_pix/);
 assert.match(ci,/Regularizacao inconsistente/);
 assert.match(ci,/v_rejeicoes<>3/);
});

test("erro da carteira não apresenta saldo zero nem permite solicitação sem confirmação",()=>{
 const errorSection=courier.slice(courier.indexOf("async function carregarCarteira()"),courier.indexOf("async function solicitarSaque()"));
 assert.match(errorSection,/motoboyAsaasBalance"\)\) \$\("motoboyAsaasBalance"\)\.textContent = "Indisponível"/);
 assert.match(errorSection,/motoboySaidaSubmit"\)\) \$\("motoboySaidaSubmit"\)\.disabled = true/);
 assert.match(errorSection,/motoboyResidualSubmit"\)\) \$\("motoboyResidualSubmit"\)\.disabled = true/);
 assert.match(errorSection,/motoboySaidaBloco"\)\) \$\("motoboySaidaBloco"\)\.hidden = true/);
 assert.match(errorSection,/Isso não significa que seus créditos foram zerados/);
});
