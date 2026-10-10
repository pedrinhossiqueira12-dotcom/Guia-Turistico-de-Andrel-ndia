"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const escrow=read("supabase/pending-migrations/20261009235940_reserva_escrow_excepcional_sem_pix.sql");
const preflight=read("supabase/pending-migrations/20261009235945_preconferencia_bloquear_separacao_existente.sql");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/motoboy.js");

test("escrow único por pedido, titular e crédito: não há idempotência fingida",()=>{
 assert.match(escrow,/CREATE TABLE IF NOT EXISTS public\.catalogo_asaas_separacoes_excepcionais \(/);
 assert.match(escrow,/UNIQUE\(tipo,solicitacao_id\)/);
 assert.match(escrow,/UNIQUE\(motoboy_id\)/);
 assert.match(escrow,/remuneracao_id uuid NOT NULL UNIQUE REFERENCES/);
 assert.match(escrow,/situacao text NOT NULL DEFAULT 'congelada' CHECK\(situacao='congelada'\)/);
 assert.match(escrow,/valor_centavos bigint NOT NULL CHECK\(valor_centavos>0\)/);
 assert.match(escrow,/fingerprint_sha256 text NOT NULL CHECK/);
});

test("RPC reserva TODOS créditos comprovados, sem limite de 1000 ou aprovação bancária",()=>{
 assert.match(escrow,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_separar_creditos_excepcionais/);
 assert.match(escrow,/hashtextextended\('asaas-saque:'\|\|v_uid::text,0\)/);
 assert.match(escrow,/ORDER BY r\.id FOR UPDATE OF r/);
 assert.match(escrow,/catalogo_private\.catalogo_v2_financiado\(r\.pedido_id\)/);
 assert.match(escrow,/catalogo_asaas_saque_itens/);
 assert.match(escrow,/catalogo_asaas_separacoes_excepcionais_itens/);
 assert.match(escrow,/v_total<>v_snapshot/);
 assert.match(escrow,/v_hash IS DISTINCT FROM v_check->>'fingerprint_creditos_sha256'/);
 assert.match(escrow,/'pagamento_autorizado',false,'transferencia_criada',false/);
 assert.match(escrow,/'baixa_realizada',false,'somente_contabil',true/);
 assert.doesNotMatch(escrow,/\bLIMIT\s+1000\b|POST \/transfers|INSERT INTO public\.catalogo_repasses_v2/);
});

test("reuso indevido de créditos é bloqueado com trigger e valor imutável",()=>{
 assert.match(escrow,/CREATE TRIGGER zzz_catalogo_asaas_guardar_saque_sem_escrow/);
 assert.match(escrow,/BEFORE INSERT ON public\.catalogo_asaas_saques/);
 assert.match(escrow,/CREATE TRIGGER catalogo_asaas_escrow_credito_guard/);
 assert.match(escrow,/BEFORE UPDATE ON public\.catalogo_remuneracoes_v2/);
 assert.match(escrow,/Credito em separacao excepcional nao pode ser modificado nem liquidado/);
 assert.match(escrow,/NEW\.status IN \('retido','pendencia_revisao'\)/);
 assert.match(escrow,/AND OLD\.financiamento_comprovado AND NOT NEW\.financiamento_comprovado/);
 assert.match(preflight,/AND v_separacoes=0/);
 assert.match(preflight,/'separacoes_contabeis_sem_liquidacao',v_separacoes/);
});

test("clientes nunca acionam reserva nem editam escrow; interface não exibe falso Pix",()=>{
 assert.match(escrow,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_separar_creditos_excepcionais\(text,uuid\)/);
 assert.match(escrow,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(escrow,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_separar_creditos_excepcionais\(text,uuid\)/);
 assert.match(escrow,/TO service_role/);
 assert.match(escrow,/GRANT SELECT ON public\.catalogo_asaas_separacoes_excepcionais/);
 assert.doesNotMatch(escrow,/GRANT SELECT,INSERT|GRANT UPDATE|GRANT DELETE/);
 assert.doesNotMatch(edge,/rpc\("catalogo_asaas_separar_creditos_excepcionais"/);
 assert.match(edge,/separacao_contabil_excepcional:separacaoContabil\|\|null/);
 assert.match(edge,/!separacaoContabil&&ENVIRONMENT==="sandbox"/);
 assert.match(ui,/ainda NÃO pagas/);
 assert.match(ui,/NÃO houve Pix nem quitação/);
});

test("PostgreSQL testa dois créditos, duplicidade, mutação, baixa falsa e saque comum",()=>{
 assert.match(ci,/DO \$escrow_creditos\$/);
 assert.match(ci,/v_reserva->>'creditos_separados' IS DISTINCT FROM '2'/);
 assert.match(ci,/v_reserva->>'valor_centavos' IS DISTINCT FROM '12000'/);
 assert.match(ci,/v_posreserva->>'separacoes_contabeis_sem_liquidacao' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_duplicada->>'separacao_id' IS DISTINCT FROM v_reserva->>'separacao_id'/);
 assert.match(ci,/Crédito separado recebeu baixa artificial/);
 assert.match(ci,/Saque comum criado sobre separação excepcional/);
 assert.match(ci,/has_function_privilege\('anon'/);
 assert.match(ci,/has_table_privilege\('service_role'/);
});
