"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-pedido-offline/index.ts","utf8");
const sql=fs.readFileSync("supabase/staging-only/asaas_qa_loja_offline_20261011.sql","utf8");
test("QA offline sem MP permanece restrito por URL EXATA do projeto STAGING",()=>{
 assert.match(edge,/SUPABASE_URL === "https:\/\/jbttwihctuibchhcyqtl\.supabase\.co"/);
 assert.match(edge,/new Set\(\["asaas-homologacao", "asaas-cob02"\]\) : new Set<string>\(\)/);
 assert.match(edge,/!receiver && !QA_STAGING_COMMERCE_IDS\.has\(comercioId\)/);
 assert.match(edge,/if \(!catalog \|\| catalog\.bloqueado \|\| !published\)/);
 assert.match(edge,/const qaCheckout = comercio === "asaas-cob02" && QA_STAGING_COMMERCE_IDS\.has\(comercio\)/);
 assert.match(edge,/if \(!OFFLINE_CHECKOUT_ENABLED && !qaCheckout\)/);
});
test("Chave AES existente valida permanece prioritária, mas legado inválido admite fallback válido",()=>{
 assert.match(edge,/Deno\.env\.get\("MP_OAUTH_ENCRYPTION_KEY"\)/);
 assert.match(edge,/Deno\.env\.get\("CATALOGO_COMPROVANTE_KEY"\)/);
 assert.match(edge,/Deno\.env\.get\("SUPABASE_COMPROVANTE_KEY"\)/);
 assert.match(edge,/\.find\(\(candidate\) => typeof candidate === "string" && decodeKey\(candidate\)\.length === 32\)/);
 assert.match(edge,/if \(decodeKey\(COMPROVANTE_KEY\)\.length !== 32\)/);
});
test("migração QA está fora das migrações produtivas e mantém loja publicada/desbloqueada",()=>{
 assert.match(sql,/STAGING ONLY/);
 assert.match(sql,/cp\.status='ativo'/);
 assert.match(sql,/NOT c\.bloqueado/);
 assert.match(sql,/c\.proprietario_id IS NOT NULL/);
 assert.match(sql,/r\.status='ativo' AND r\.conta_externa_id IS NOT NULL/);
 assert.match(sql,/p_comercio_id='asaas-homologacao'/);
 assert.doesNotMatch(sql,/\bINSERT\b|\bUPDATE\b.*\bcatalogo_pedidos\b|\bDELETE\b.*\bcatalogo_fechamentos\b/i);
});

const vm=require("node:vm");
const qaHtml=fs.readFileSync("pages/asaas-homologacao-sandbox.html","utf8");
const qaDeliverySql=fs.readFileSync("supabase/staging-only/asaas_qa_entrega_v2_cob04_20261012.sql","utf8");
test("COB-04: entrega QA usa endpoints existentes, JWT e aceite, sem saque",()=>{
 const inline=qaHtml.match(/<script>\s*([\s\S]*?)<\/script>/);
 assert.ok(inline,"JS de QA existe");
 assert.doesNotThrow(()=>new vm.Script(inline[1]));
 assert.match(qaHtml,/id="qa-create-delivery"/);
 assert.match(qaHtml,/id="qa-authorize"/);
 assert.match(qaHtml,/id="qa-moto-terms"/);
 assert.match(qaHtml,/id="qa-moto-finish"/);
 assert.match(qaHtml,/deliveryApi\("autorizar_motoboy"/);
 assert.match(qaHtml,/deliveryApi\("atribuir_pedido"/);
 assert.match(qaHtml,/call\("aceitar_termos",\{papel:"motoboy"/);
 assert.match(qaHtml,/deliveryApi\("confirmar_entrega"/);
 assert.match(qaHtml,/recebimento_confirmado:true/);
 assert.match(qaHtml,/taxa_total_centavos!==700/);
 assert.match(qaHtml,/taxa_plataforma_centavos!==500/);
 assert.match(qaHtml,/taxa_motoboy_centavos!==200/);
 assert.doesNotMatch(qaHtml,/acao:\s*"solicitar_saque"/);
});
test("COB-04: modalidade entrega somente em asaas-cob02 STAGING, sem linhas financeiras",()=>{
 assert.match(qaDeliverySql,/STAGING jbttwihctuibchhcyqtl/);
 assert.match(qaDeliverySql,/WHERE comercio_id='asaas-cob02'/);
 assert.match(qaDeliverySql,/ARRAY\['retirada','entrega'\]::text\[\]/);
 assert.match(qaDeliverySql,/v_metodos IS DISTINCT FROM ARRAY\['dinheiro'\]::text\[\]/);
 assert.doesNotMatch(qaDeliverySql,/\b(?:INSERT|DELETE)\b/i);
 assert.doesNotMatch(qaDeliverySql,/\bUPDATE\s+public\.(?:catalogo_pedidos|catalogo_fechamentos_offline|catalogo_fatura_cobrancas|catalogo_remuneracoes_v2)\b/i);
});

test("COB-04: botões de retirada antiga indisponíveis durante teste de entrega",()=>{
 assert.match(qaHtml, /id="qa-create" disabled/);
 assert.match(qaHtml, /id="qa-finish" disabled/);
 assert.match(qaHtml, /COB-04 · Entrega V2 com motoboy/);
 assert.match(qaHtml, /value="2027-02"/);
});
test("COB-04: fechamento exige entrega física e pagamento confirmado para TODOS os componentes",()=>{
 const guardSql=fs.readFileSync("supabase/pending-migrations/20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql","utf8");
 const matches=guardSql.match(/p\.codigo_entrega_usado_em IS NOT NULL/g)||[];
 assert.equal(matches.length,5,"soma, dois componentes e duas atualizações precisam aplicar guarda idêntica");
 assert.match(guardSql,/p\.status='entregue'/);
 assert.match(guardSql,/p\.status_pagamento='aprovado'/);
 assert.match(guardSql,/p\.provedor='offline'/);
 assert.match(guardSql,/IF v_status='pago'/);
 assert.doesNotMatch(guardSql,/\b(?:TRUNCATE|DROP TABLE)\b/i);
});


test("COB-04: cada ID referenciado por JavaScript QA existe no HTML",()=>{
 const inline=qaHtml.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
 assert.ok(inline,"JS QA carregado");
 const names=[...new Set([...inline.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]))];
 assert.ok(names.length>=30,"cobertura de controles QA");
 for(const id of names){
  assert.ok(qaHtml.includes('id="'+id+'"'),"elemento DOM nao encontrado: "+id);
 }
});
test("COB-04: valida o e-mail de motoboy e codigo antes da API, sem exigir UID manual",()=>{
 const vm=require("node:vm");
 const matchEmail=qaHtml.match(/if\(!([^\n]+?)\.test\(email\)\|\|!nome\)/);
 assert.ok(matchEmail,"validador de e-mail QA encontrado");
 const regexEmail=vm.runInNewContext(matchEmail[1]);
 assert.equal(regexEmail.test("entregador.teste@exemplo.com"),true);
 assert.equal(regexEmail.test("sem-arroba.exemplo.com"),false);
 assert.equal(regexEmail.test("a@b"),false);
 const matchCode=qaHtml.match(/if\(!([^\n]+?)\.test\(code\)\)/);
 assert.ok(matchCode,"validador de codigo QA encontrado");
 const regexCode=vm.runInNewContext(matchCode[1]);
 assert.equal(regexCode.test("123456"),true);
 assert.equal(regexCode.test("12345"),false);
 assert.equal(regexCode.test("12345a"),false);
 assert.match(qaHtml,/id="qa-moto-id" readonly/);
 assert.match(qaHtml,/id="qa-delivery-feedback" role="status"/);
 assert.match(qaHtml,/id="qa-delivery-result"/);
 assert.match(qaHtml,/\$\("qa-delivery-feedback"\)\.textContent=\$\("qa-feedback"\)\.textContent/);
});

test("COB-04: botao 8 exige autorizacao persistida no servidor ANTES de criar entrega",()=>{
 const guard=qaHtml.indexOf('const autorizacoes=await deliveryApi("listar_motoboys")');
 const create=qaHtml.indexOf('const out=await qaApi("catalogo-pedido-offline"');
 assert.ok(guard>0 && create>guard,"consulta API proprietario precede checkout");
 assert.match(qaHtml,/item\.ativo===true && String\(item\.email\|\|""\)\.toLowerCase\(\)===motoEmail/);
 assert.match(qaHtml,/Nenhum motoboy autorizado com este e-mail nesta loja QA/);
 assert.match(qaHtml,/if\(!window\.confirm\("Autorizar este entregador[^\n]+\)return false;/);
 assert.match(qaHtml,/if\(!window\.confirm\("Criar UM pedido fictício[^\n]+\)return false;/);
 assert.match(qaHtml,/result===false\?"Operação cancelada pelo usuário/);
});

test("COB-04: conciliação da fatura só libera pedidos do snapshot pago",()=>{
 const src=fs.readFileSync("supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql","utf8");
 const guarda=/fc\.fechamento_id=v_cobranca\.fechamento_id/g;
 assert.equal((src.match(guarda)||[]).length,7,"todas as sete mutações de pagamento/reversão precisam ser protegidas");
 assert.equal((src.match(/fc\.pedido_id=/g)||[]).length,7,"todas as mutações vinculam pedido ao componente");
 assert.equal((src.match(/fc\.tipo='plataforma'/g)||[]).length,1,"crédito plataforma tem componente e valor próprios");
 assert.equal((src.match(/fc\.tipo='logistica'/g)||[]).length,2,"remuneração e seu lançamento têm componente logístico");
 assert.match(src,/AND fc\.valor_centavos=l\.valor_centavos/);
 assert.match(src,/AND fc\.valor_centavos=r\.valor_centavos/);
 assert.match(src,/IF v_cobranca\.status='pago'/);
 assert.match(src,/IF p_estado IN \('estornado','contestado'\)/);
 assert.doesNotMatch(src,/\b(?:TRUNCATE|DROP TABLE|DELETE FROM)\b/i);
});

test("COB-06: seletor de produto QA em STAGING e guarda de fatura inferior a R$5",()=>{
 assert.match(qaHtml,/id="qa-product"/);
 assert.match(qaHtml,/id="qa-products-load"/);
 assert.match(qaHtml,/\.eq\("id",selectedId\)/);
 assert.match(qaHtml,/expectedTotal=expectedPlatform\+expectedMotoboy/);
 assert.match(qaHtml,/expectedTotal<500/);
 assert.match(qaHtml,/total_comissao_centavos<500/);
 assert.match(qaHtml,/NÃO emita Pix/);
});
