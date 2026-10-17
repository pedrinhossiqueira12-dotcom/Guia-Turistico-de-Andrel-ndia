"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {diagnosticarResolucaoEscrowInerte:avaliar}=require(
 "../scripts/validacao-pagamentos/simular-resolucao-escrow-inerte.cjs");
const credito=(n,valor=100,competencia="2026-10")=>({
 remuneracao_id:"cred-ficticio-"+n,valor_centavos:valor,competencia
});
const ensaio=(creditos,extras={})=>({
 separacao:{situacao:"congelada",valor_centavos:creditos.reduce(
  (acc,c)=>acc+c.valor_centavos,0)},
 creditos,contagem_creditos_no_livro:creditos.length,
 observacoes_bancarias:[],...extras
});
const travado=r=>{
 for(const campo of [
  "cobertura_integral_do_livro_comprovada",
  "beneficiario_original_confirmado","ausencia_pix_anterior_comprovada",
  "revisores_fortes_independentes_confirmados","aprovado_em_transacao",
  "pagamento_autorizado","liberacao_autorizada","baixa_realizada",
  "movimenta_dinheiro"
 ])assert.equal(r[campo],false,campo);
 assert.equal(r.status_operacional,"HOLD_OBRIGATORIO");
 assert.equal(r.modo,"ENSAIO_OFFLINE_SOMENTE_LEITURA");
};

test("#43: mais de 1.000 remuneracoes e varias competencias sem corte ou arredondamento",()=>{
 const creditos=Array.from({length:1601},(_,i)=>credito(i,70,
  i%3===0?"2026-07":i%3===1?"2026-08":"2026-09"));
 const r=avaliar(ensaio(creditos));
 assert.equal(r.creditos_examinados,1601);
 assert.equal(r.competencias_examinadas,3);
 assert.equal(r.soma_centavos_na_amostra,1601*70);
 assert.equal(r.composicao_conferida_somente_na_amostra,true);
 assert.equal(r.acima_teto_pix_unitario_na_amostra,false);
 travado(r);
});
test("#43: saldo menor que R$100 permanece acumulado, sem liberacao",()=>{
 const r=avaliar(ensaio([credito(1,3000),credito(2,3000)]));
 assert.equal(r.soma_centavos_na_amostra,6000);
 assert.equal(r.abaixo_minimo_saque_na_amostra,true);
 assert.equal(r.composicao_conferida_somente_na_amostra,true);
 travado(r);
});
test("#43: carteira superior a R$5000 nao e truncada nem confundida com teto por transferencia",()=>{
 const creditos=Array.from({length:1801},(_,i)=>credito(i,400));
 const r=avaliar(ensaio(creditos));
 assert.equal(r.soma_centavos_na_amostra,720400);
 assert.equal(r.creditos_examinados,1801);
 assert.equal(r.acima_teto_pix_unitario_na_amostra,true);
 assert.equal(r.composicao_conferida_somente_na_amostra,true);
 travado(r);
});
test("#43: referencia duplicada e soma divergente nunca configuram quitação",()=>{
 const c=[credito("duplicado",500),credito("duplicado",500)];
 const r=avaliar(ensaio(c,{separacao:{situacao:"congelada",valor_centavos:500}}));
 assert.ok(r.alertas.includes("credito_duplicado"));
 assert.ok(r.alertas.includes("soma_diferente_da_reserva"));
 assert.equal(r.composicao_conferida_somente_na_amostra,false);
 travado(r);
});
test("#43: mesmo numero de itens nao prova paginacao completa ou origem do Pix",()=>{
 const c=[credito(1,100),credito(2,100)];
 const r=avaliar(ensaio(c,{contagem_creditos_no_livro:3}));
 assert.ok(r.alertas.includes("contagem_da_amostra_divergente"));
 const mesmo=avaliar(ensaio(c));
 assert.equal(mesmo.cobertura_integral_do_livro_comprovada,false);
 travado(r);travado(mesmo);
});
test("#43: centavos invalidos e overflow nao desaparecem por arredondamento",()=>{
 const c=[credito(1,Number.MAX_SAFE_INTEGER),credito(2,1)];
 const r=avaliar(ensaio(c,{separacao:{situacao:"congelada",valor_centavos:1}}));
 assert.ok(r.alertas.includes("soma_fora_da_precisao_segura"));
 assert.equal(r.soma_centavos_na_amostra,null);
 travado(r);
 for(const valor of [0,-1,1.01,"100",Number.MAX_SAFE_INTEGER+1]){
  const item=avaliar(ensaio([credito(1,valor)],{
   separacao:{situacao:"congelada",valor_centavos:100}
  }));
  assert.ok(item.alertas.includes("valor_de_credito_invalido"));
  assert.equal(item.composicao_conferida_somente_na_amostra,false);
  travado(item);
 }
});
test("#43: status DONE ou falha observada nao comprova beneficiario nem libera dinheiro",()=>{
 const c=[credito(1,100)];
 const done=avaliar(ensaio(c,{observacoes_bancarias:[{estado_banco:"DONE"}]}));
 assert.ok(done.alertas.includes("done_observado_nao_comprova_destino"));
 const contradicao=avaliar(ensaio(c,{observacoes_bancarias:[
  {estado_banco:"DONE"},{estado_banco:"CANCELLED"}]}));
 assert.equal(contradicao.classificacao_documental,"contestacao");
 assert.ok(contradicao.alertas.includes("estados_bancarios_contraditorios"));
 const pendente=avaliar(ensaio(c,{observacoes_bancarias:[
  {estado_banco:"PENDING"}]}));
 assert.ok(pendente.alertas.includes("processamento_bancario_observado"));
 for(const r of [done,contradicao,pendente])travado(r);
});
test("#43: dados externos alegando dupla aprovacao, comprovantes ou pagamento nao destravam",()=>{
 const c=[credito(1,100)];
 const injetado=ensaio(c,{
  pagamento_autorizado:true,liberacao_autorizada:true,
  ausencia_pix_anterior_comprovada:true,beneficiario_original_confirmado:true,
  revisores_independentes:2,pix_pago:true,
  chave_pix:"NUNCA_EXIBIR_CHAVE",
  observacoes_bancarias:[{estado_banco:"DONE",cpf:"NUNCA_EXIBIR_CPF"}]
 });
 const r=avaliar(injetado);
 assert.equal(r.classificacao_documental,"revisao");
 assert.equal(JSON.stringify(r).includes("NUNCA_EXIBIR"),false);
 travado(r);
});
test("#43: simulacao pura, deterministica, imutavel, sem rede, SQL, chave ou API financeira",()=>{
 const c=[credito(1,150)];
 const e=ensaio(c);
 const antes=JSON.stringify(e);
 const um=avaliar(e),dois=avaliar(e);
 assert.deepEqual(um,dois);
 assert.equal(JSON.stringify(e),antes);
 assert.equal(Object.isFrozen(um),true);
 assert.equal(Object.isFrozen(um.alertas),true);
 assert.ok(um.estados_futuros_modelados.includes("pago_comprovado"));
 assert.ok(um.estados_futuros_modelados.includes("liberado_sem_pagamento"));
 travado(um);
 const fonte=fs.readFileSync(
  "scripts/validacao-pagamentos/simular-resolucao-escrow-inerte.cjs","utf8");
 assert.doesNotMatch(fonte,/fetch\(|require\(["']https?|\.insert\(|\.update\(|\.delete\(|\bPOST\b|createClient|service_role|Deno\.env/);
});
