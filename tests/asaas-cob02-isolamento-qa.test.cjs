"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-pedido-offline/index.ts","utf8");
const sql=fs.readFileSync("supabase/staging-only/asaas_qa_loja_offline_20261011.sql","utf8");
test("QA offline sem MP permanece restrito por URL EXATA do projeto STAGING",()=>{
 assert.match(edge,/SUPABASE_URL === "https:\/\/jbttwihctuibchhcyqtl\.supabase\.co"/);
 assert.match(edge,/\? "asaas-homologacao" : ""/);
 assert.match(edge,/!receiver && comercioId !== QA_STAGING_COMMERCE_ID/);
 assert.match(edge,/if \(!catalog \|\| catalog\.bloqueado \|\| !published\)/);
 assert.match(edge,/if \(!OFFLINE_CHECKOUT_ENABLED\)/);
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
