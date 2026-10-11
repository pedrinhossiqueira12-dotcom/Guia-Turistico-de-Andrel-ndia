"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {diagnosticarEnvioPixIncertoInerte:diag}=require(
 "../scripts/validacao-pagamentos/simular-envio-pix-incerto-inerte.cjs");

const sep="ed830000-1111-4111-8111-000000000001";
const req="dd830000-1111-4111-8111-000000000002";
const attempt="ad830000-1111-4111-8111-000000000003";
const op=Object.freeze({separacao_id:sep,solicitacao_id:req,
 tentativa_id:attempt,tipo:"saida",referencia_externa:"guia-exc:saida:"+req,
 valor_centavos:12000,fingerprint_sha256:"a".repeat(64)});
const typ=(i,t,patch={})=>({
 evento_id:"ce830000-1111-4111-8111-"+String(i).padStart(12,"0"),
 sequencia:i,tipo:t,tentativa_id:attempt,
 referencia_externa:op.referencia_externa,valor_centavos:12000,...patch
});
const base=(types,extra={})=>({operacao:op,
 eventos:types.map((t,i)=>typ(i+1,t)),...extra});
function hold(result){
 assert.equal(result.modo,"LABORATORIO_SEM_REDE");
 assert.equal(result.status_operacional,"HOLD_OBRIGATORIO");
 for(const k of ["ausencia_pix_anterior_comprovada",
  "beneficiario_original_confirmado","liquidacao_comprovada_independentemente",
  "revisores_mfa_independentes_confirmados","pode_reenviar_post",
  "pode_criar_novo_saque","pagamento_autorizado",
  "liberacao_autorizada","baixa_realizada","movimenta_dinheiro"])
  assert.equal(result[k],false,k);
 assert.equal(result.necessita_apuracao_bancaria_independente,true);
 assert.ok(Object.isFrozen(result));
 assert.ok(Object.isFrozen(result.alertas));
}

test("#43: sem eventos nao comprova que nenhum Pix foi enviado",()=>{
 const r=diag(base([]));
 assert.equal(r.classificacao_documental,"historico_inconsistente");
 assert.ok(r.alertas.includes("historico_vazio"));
 assert.ok(r.alertas.includes("sem_marco_local_nao_prova_que_nao_houve_pix"));
 hold(r);
});
test("#43: INTENCAO isolada nao concede POST nem prova ausencia de Pix",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA"]));
 assert.equal(r.classificacao_documental,"sem_prova_suficiente_de_envio_ou_ausencia");
 assert.equal(r.houve_marco_de_envio_no_livro_local,false);
 hold(r);
});
test("#43: resposta perdida apos inicio do envio nao autoriza reenvio",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","RESPOSTA_PERDIDA"]));
 assert.equal(r.classificacao_documental,"envio_potencialmente_efetivado");
 assert.equal(r.resultado_de_envio_desconhecido,true);
 assert.ok(r.alertas.includes("resultado_de_envio_incerto"));
 hold(r);
});
test("#43: erro HTTP 5xx nao distingue falha de transferencia processada",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","HTTP_ERRO"]));
 assert.equal(r.classificacao_documental,"envio_potencialmente_efetivado");
 hold(r);
});
test("#43: HTTP aceito tambem nao comprova liquidacao",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","HTTP_ACEITO"]));
 assert.ok(r.alertas.includes("http_aceito_nao_prova_liquidacao"));
 hold(r);
});
test("#43: GET FAILED ou CANCELLED apos resposta perdida nao libera creditos",()=>{
 for(const status of ["GET_FAILED","GET_CANCELLED"]){
  const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO",
   "RESPOSTA_PERDIDA",status]));
  assert.ok(r.alertas.includes("get_falha_nao_prova_ausencia_de_pix"));
  hold(r);
 }
});
test("#43: GET DONE nao prova beneficiario original nem quita saldo",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","GET_DONE"]));
 assert.equal(r.classificacao_documental,"done_nao_comprovado_independentemente");
 assert.equal(r.existe_observacao_done_local,true);
 hold(r);
});
test("#43: DONE depois de FAILED e processamento gera contradicao sem resolver",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","GET_PENDING",
  "GET_FAILED","GET_DONE"]));
 assert.equal(r.classificacao_documental,"observacoes_contraditorias");
 assert.ok(r.alertas.includes("observacoes_bancarias_contraditorias"));
 hold(r);
});
test("#43: solicitacao de reenvio de POST sempre recusa novo pagamento",()=>{
 const r=diag(base(["INTENCAO_REGISTRADA","ENVIO_INICIADO",
  "RESPOSTA_PERDIDA","REENVIO_SOLICITADO"]));
 assert.ok(r.alertas.includes("reenvio_post_solicitado_bloqueado"));
 hold(r);
});
test("#43: identidade divergente, referencia ou centavos adulterados falham fechados",()=>{
 const history=["INTENCAO_REGISTRADA","ENVIO_INICIADO","GET_DONE"];
 for(const patch of [
  {tentativa_id:"fd830000-1111-4111-8111-000000000004"},
  {referencia_externa:"guia-exc:saida:nao-existe"},
  {valor_centavos:11999},{valor_centavos:"12000"},{valor_centavos:12000.5}
 ]){
  const events=base(history).eventos;
  events[2]={...events[2],...patch};
  const r=diag({operacao:op,eventos:events});
  assert.equal(r.classificacao_documental,"historico_inconsistente");
  assert.ok(r.alertas.includes("identidade_bancaria_observada_divergente"));
  hold(r);
 }
});
test("#43: sequencia faltante, reorder, duplicidade e replay conflitante",()=>{
 const history=base(["INTENCAO_REGISTRADA","ENVIO_INICIADO"]).eventos;
 const casos=[
  [history[0],{...history[1],sequencia:5}],
  [history[1],history[0]],
  [history[0],history[0]],
  [history[0],{...history[1],evento_id:history[0].evento_id}],
 ];
 for(const eventos of casos){
  const r=diag({operacao:op,eventos});
  assert.equal(r.classificacao_documental,"historico_inconsistente");
  hold(r);
 }
});
test("#43: operacao invalida ou flag forjada de autorizacao nao muda HOLD",()=>{
 for(const opInvalida of [
  {...op,solicitacao_id:"outra"},
  {...op,referencia_externa:"guia-exc:saida:"+sep},
  {...op,tipo:"pago_comprovado"},
  {...op,valor_centavos:0},
  {...op,fingerprint_sha256:"x".repeat(64)}
 ]){
  const r=diag({operacao:opInvalida,eventos:base(["INTENCAO_REGISTRADA"]).eventos});
  assert.ok(r.alertas.includes("identidade_ou_valor_de_operacao_invalido"));
  hold(r);
 }
 const forged=diag({...base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","GET_DONE"]),
  pagamento_autorizado:true,pode_reenviar_post:true,beneficiario_original_confirmado:true,
  cpf:"NAO_EXIBIR_CPF",chave_pix:"NAO_EXIBIR_CHAVE"});
 assert.equal(JSON.stringify(forged).includes("NAO_EXIBIR"),false);
 hold(forged);
});
test("#43: milhares de GETs nao implicam prova externa nem truncam historico",()=>{
 const tipos=["INTENCAO_REGISTRADA","ENVIO_INICIADO",...
  Array.from({length:1601},()=> "GET_PENDING")];
 const r=diag(base(tipos));
 assert.equal(r.eventos_examinados,1603);
 assert.equal(r.eventos_unicos,1603);
 assert.equal(r.classificacao_documental,"envio_potencialmente_efetivado");
 hold(r);
});
test("#43: avaliacao pura deterministica, sem importacao de API ou rede",()=>{
 const input=base(["INTENCAO_REGISTRADA","ENVIO_INICIADO","RESPOSTA_PERDIDA"]);
 const before=JSON.stringify(input),first=diag(input),second=diag(input);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(first,second);
 const src=fs.readFileSync(
  "scripts/validacao-pagamentos/simular-envio-pix-incerto-inerte.cjs","utf8");
 assert.doesNotMatch(src,/(?:fetch|XMLHttpRequest|createClient|Deno\.env|http_post)\s*\(/);
 assert.doesNotMatch(src,/\.insert\(|\.update\(|\.delete\(/);
 hold(first);
});
